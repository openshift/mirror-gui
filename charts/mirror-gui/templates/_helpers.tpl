{{- define "mirror-gui.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mirror-gui.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "mirror-gui.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mirror-gui.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | quote }}
app.kubernetes.io/name: {{ include "mirror-gui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "mirror-gui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mirror-gui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
