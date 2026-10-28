{{- define "mirror-gui.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mirror-gui.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Chart-owned labels merged over .Values.labels. Merging rather than concatenating keeps a
user-supplied key that collides with a chart-owned one from emitting a duplicate YAML key,
which would make the whole manifest undecodable. Chart-owned values win.
*/}}
{{- define "mirror-gui.labels" -}}
{{- $owned := dict
      "helm.sh/chart" (printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_")
      "app.kubernetes.io/name" (include "mirror-gui.name" .)
      "app.kubernetes.io/instance" .Release.Name
      "app.kubernetes.io/managed-by" .Release.Service -}}
{{- include "mirror-gui.stringMap" (merge $owned (.Values.labels | default dict)) -}}
{{- end }}

{{/*
Renders a map with every value converted to a string. Label and annotation values must be
strings, but `--set labels.tier=1` or `--set annotations.enabled=true` hands the chart a number
or a boolean, which toYaml would emit unquoted and the API server would reject.
*/}}
{{- define "mirror-gui.stringMap" -}}
{{- $strings := dict -}}
{{- range $key, $value := . -}}
{{- $_ := set $strings $key (toString $value) -}}
{{- end -}}
{{- toYaml $strings -}}
{{- end }}

{{- define "mirror-gui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mirror-gui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name | quote }}
{{- end }}
