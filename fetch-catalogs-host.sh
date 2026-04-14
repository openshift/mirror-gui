#!/bin/bash

# Fetches operator catalog metadata from registry.redhat.io for all supported OCP versions.
# Uses `oc image extract` to pull FBC configs directly from registry images (no Podman required).
# Requires: oc CLI, python3, PyYAML, jq, and a pull secret in pull-secret/pull-secret.json.

set +e

OCP_VERSIONS=("4.16" "4.17" "4.18" "4.19" "4.20" "4.21")
CATALOG_TYPES=("redhat-operator-index" "certified-operator-index" "community-operator-index")
CATALOG_DATA_DIR="./catalog-data"
MAX_PARALLEL_JOBS=${MAX_PARALLEL_JOBS:-3}

mkdir -p "$CATALOG_DATA_DIR"

TOTAL_CATALOGS=0
SUCCESSFUL_CATALOGS=0
FAILED_CATALOGS=0

extract_catalog_data() {
    local catalog_type=$1
    local ocp_version=$2
    local catalog_url="registry.redhat.io/redhat/${catalog_type}:v${ocp_version}"
    local output_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"

    mkdir -p "$output_dir"

    local try_count=0
    local max_retries=3

    while [ $try_count -lt $max_retries ]; do
        try_count=$((try_count + 1))
        echo "Extracting ${catalog_type} v${ocp_version} (attempt $try_count)..."

        mkdir -p "${output_dir}/configs"
        if oc image extract \
            --registry-config=pull-secret/pull-secret.json \
            --path /configs/:"${output_dir}/configs" \
            "$catalog_url" 2>/dev/null; then
            return 0
        else
            rm -rf "${output_dir}/configs" 2>/dev/null
            if [ $try_count -eq $max_retries ]; then
                echo "ERROR: Failed to extract ${catalog_url} after $max_retries attempts" >&2
                return 1
            fi
            sleep 2
        fi
    done
}

process_catalog_data() {
    local catalog_type=$1
    local ocp_version=$2
    local catalog_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"
    local operators_file="${catalog_dir}/operators.json"
    local dependencies_file="${catalog_dir}/dependencies.json"

    if [ ! -d "${catalog_dir}/configs" ]; then
        echo "ERROR: No configs directory for ${catalog_type} v${ocp_version}" >&2
        return 1
    fi

    if ! python3 "scripts/catalog_metadata.py" generate \
        --catalog-dir "$catalog_dir" \
        --catalog-type "$catalog_type" \
        --ocp-version "v${ocp_version}" \
        --operators-file "$operators_file" \
        --dependencies-file "$dependencies_file"; then
        echo "ERROR: Failed to generate metadata for ${catalog_type} v${ocp_version}" >&2
        return 1
    fi

    local operator_count
    operator_count=$(jq '. | length' "$operators_file" 2>/dev/null || echo "0")

    cat > "${catalog_dir}/catalog-info.json" << EOF
{
  "catalog_type": "${catalog_type}",
  "ocp_version": "v${ocp_version}",
  "catalog_url": "registry.redhat.io/redhat/${catalog_type}:v${ocp_version}",
  "operator_count": ${operator_count}
}
EOF
}

main() {
    for cmd in oc jq python3; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            echo "ERROR: $cmd is not available" >&2
            exit 1
        fi
    done

    if [ ! -f "pull-secret/pull-secret.json" ]; then
        echo "ERROR: pull-secret/pull-secret.json not found" >&2
        exit 1
    fi

    if ! python3 -c "import yaml" 2>/dev/null; then
        echo "ERROR: PyYAML is not available for python3" >&2
        exit 1
    fi

    TOTAL_CATALOGS=$((${#OCP_VERSIONS[@]} * ${#CATALOG_TYPES[@]}))

    CATALOG_JOBS=()
    for ocp_version in "${OCP_VERSIONS[@]}"; do
        for catalog_type in "${CATALOG_TYPES[@]}"; do
            CATALOG_JOBS+=("${catalog_type}:${ocp_version}")
        done
    done

    export -f extract_catalog_data process_catalog_data
    export CATALOG_DATA_DIR

    local job_pids=()
    local job_num=0
    local results_file
    results_file=$(mktemp)

    process_catalog_job() {
        local catalog_type="$1"
        local ocp_version="$2"
        local catalog_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"

        if extract_catalog_data "$catalog_type" "$ocp_version"; then
            if process_catalog_data "$catalog_type" "$ocp_version"; then
                rm -rf "${catalog_dir}/configs"
                echo "SUCCESS:${catalog_type}:${ocp_version}" >> "$results_file"
                return 0
            fi
        fi

        rm -rf "${catalog_dir}/configs" 2>/dev/null
        echo "FAILED:${catalog_type}:${ocp_version}" >> "$results_file"
        return 1
    }
    export -f process_catalog_job

    for catalog_job in "${CATALOG_JOBS[@]}"; do
        IFS=':' read -r catalog_type ocp_version <<< "$catalog_job"
        job_num=$((job_num + 1))

        while [ ${#job_pids[@]} -ge "$MAX_PARALLEL_JOBS" ]; do
            for i in "${!job_pids[@]}"; do
                pid=${job_pids[$i]}
                if ! kill -0 "$pid" 2>/dev/null; then
                    wait "$pid" 2>/dev/null
                    unset 'job_pids[i]'
                    job_pids=("${job_pids[@]}")
                    break
                fi
            done
            sleep 1
        done

        process_catalog_job "$catalog_type" "$ocp_version" "$job_num" &
        job_pids+=($!)
    done

    for pid in "${job_pids[@]}"; do
        wait "$pid" 2>/dev/null
    done

    if [ -f "$results_file" ]; then
        while IFS= read -r result_line || [ -n "$result_line" ]; do
            if [[ "$result_line" == SUCCESS:* ]]; then
                SUCCESSFUL_CATALOGS=$((SUCCESSFUL_CATALOGS + 1))
            elif [[ "$result_line" == FAILED:* ]]; then
                FAILED_CATALOGS=$((FAILED_CATALOGS + 1))
            fi
        done < "$results_file"
    fi

    rm -f "$results_file"

    # Build catalog-index.json from per-catalog catalog-info.json files
    cat > "${CATALOG_DATA_DIR}/catalog-index.json" << EOF
{
  "ocp_versions": $(printf '%s\n' "${OCP_VERSIONS[@]}" | jq -R . | jq -s .),
  "catalog_types": $(printf '%s\n' "${CATALOG_TYPES[@]}" | jq -R . | jq -s .),
  "catalogs": []
}
EOF

    for ocp_version in "${OCP_VERSIONS[@]}"; do
        for catalog_type in "${CATALOG_TYPES[@]}"; do
            local catalog_info="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}/catalog-info.json"
            if [ -f "$catalog_info" ]; then
                local catalog_entry
                catalog_entry=$(cat "$catalog_info")
                jq --argjson entry "$catalog_entry" '.catalogs += [$entry]' \
                    "${CATALOG_DATA_DIR}/catalog-index.json" > "${CATALOG_DATA_DIR}/catalog-index.json.tmp" && \
                    mv "${CATALOG_DATA_DIR}/catalog-index.json.tmp" "${CATALOG_DATA_DIR}/catalog-index.json"
            fi
        done
    done

    echo "Completed: ${SUCCESSFUL_CATALOGS}/${TOTAL_CATALOGS} catalogs successful, ${FAILED_CATALOGS} failed"

    if [ $FAILED_CATALOGS -gt 0 ]; then
        exit 1
    fi
}

main
