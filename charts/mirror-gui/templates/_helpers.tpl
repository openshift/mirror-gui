{{- define "mirror-gui.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mirror-gui.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "mirror-gui.name" .) | trunc 63 | trimSuffix "-" }}
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
{{- toYaml (merge $owned (.Values.labels | default dict)) -}}
{{- end }}

{{- define "mirror-gui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mirror-gui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
