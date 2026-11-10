import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  Card,
  CardBody,
  Tabs,
  Tab,
  TabTitleText,
  FormGroup,
  Button,
  ActionGroup,
  FileUpload,
  Title,
  HelperText,
  HelperTextItem,
  Alert,
  Label,
  Popover,
  Progress,
  ProgressSize,
  ProgressMeasureLocation,
  ExpandableSection,
  List,
  ListItem,
  Flex,
  Timestamp,
  TextInput,
  CodeBlock,
  CodeBlockCode,
  Tooltip,
  Checkbox,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalVariant,
} from '@patternfly/react-core';
import {
  CogIcon,
  DatabaseIcon,
  KeyIcon,
  RegistryIcon,
  SaveIcon,
  SearchIcon,
  TrashAltIcon,
  InfoCircleIcon,
  CheckCircleIcon,
  TimesCircleIcon,
  SyncAltIcon,
  EyeIcon,
  EyeSlashIcon,
  CopyIcon,
} from '@patternfly/react-icons';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { useAlerts } from '../AlertContext';

interface RegistryEntry {
  registry: string;
  username: string;
  hasAuth: boolean;
  status?: 'authenticated' | 'failed' | 'verifying' | 'not_verified';
  error?: string;
}

interface SystemInfo {
  ocMirrorVersion: string;
  systemArchitecture: string;
  availableDiskSpace: string | number;
  totalDiskSpace: string | number;
  cacheDir: string;
  hostCacheDir: string;
  cacheSizeBytes: number;
}

// Mirrors ExternalCatalog in server/catalogSettings.ts (not imported to keep server code out of the client bundle).
interface ExternalCatalogEntry {
  url: string;
  name: string;
  tag: string;
  displayName?: string;
}

interface CatalogSettingsResponse {
  supportedOcpVersions: string[];
  enabledOcpVersions: string[];
  externalCatalogs: ExternalCatalogEntry[];
  /** Set when the settings file was corrupt (defaults in use) or cleanup partly failed. */
  warning?: string | null;
}

interface CatalogSyncDiffEntry {
  catalog: string;
  newOperators: string[];
  removedOperators: string[];
  updatedOperators: { name: string; addedVersions: string[] }[];
}

/** Bash-safe single-quoted string for CACHE_DIR=... */
function shellSingleQuote(value: string): string {
  const sq = '\'';
  const escaped = value.split(sq).join(`${sq}\\${sq}${sq}`);
  return `${sq}${escaped}${sq}`;
}

interface CatalogSyncStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  lastSyncTime: string | null;
  syncStartTime: string | null;
  successCount: number;
  failedCount: number;
  totalCount: number;
  completedCatalogs: number;
  currentCatalog: string | null;
  error: string | null;
  logs: string[];
  diff: CatalogSyncDiffEntry[];
  /** True when runtime synced catalog data exists (same probe as clear sync). */
  hasRuntimeSyncData?: boolean;
}

const SettingsPage: React.FC = () => {
  const { addSuccessAlert, addDangerAlert, addWarningAlert } = useAlerts();

  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    ocMirrorVersion: '',
    systemArchitecture: '',
    availableDiskSpace: '',
    totalDiskSpace: '',
    cacheDir: '',
    hostCacheDir: '',
    cacheSizeBytes: 0,
  });
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string | number>(searchParams.get('tab') || 'pull-secret');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) setActiveTab(tab);
  }, [searchParams]);
  const [pullSecretContent, setPullSecretContent] = useState('');
  const [pullSecretFilename, setPullSecretFilename] = useState('');
  const [pullSecretStatus, setPullSecretStatus] = useState<{ detected: boolean; path: string | null }>({ detected: false, path: null });
  const [registries, setRegistries] = useState<RegistryEntry[]>([]);

  const [catalogSyncStatus, setCatalogSyncStatus] = useState<CatalogSyncStatus>({
    status: 'idle', lastSyncTime: null, syncStartTime: null, successCount: 0, failedCount: 0,
    totalCount: 0, completedCatalogs: 0, currentCatalog: null, error: null, logs: [], diff: [],
    hasRuntimeSyncData: false,
  });
  const [supportedOcpVersions, setSupportedOcpVersions] = useState<string[]>([]);
  const [savedOcpVersions, setSavedOcpVersions] = useState<string[]>([]);
  const [draftOcpVersions, setDraftOcpVersions] = useState<string[]>([]);
  const [externalCatalogs, setExternalCatalogs] = useState<ExternalCatalogEntry[]>([]);
  const [newCatalogUrl, setNewCatalogUrl] = useState('');
  const [newCatalogName, setNewCatalogName] = useState('');
  const [removeCatalogTarget, setRemoveCatalogTarget] = useState<ExternalCatalogEntry | null>(null);
  const [savingCatalogSettings, setSavingCatalogSettings] = useState(false);
  const [catalogSettingsWarning, setCatalogSettingsWarning] = useState<string | null>(null);
  const [catalogSettingsLoadError, setCatalogSettingsLoadError] = useState<string | null>(null);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const prevSyncStatusRef = useRef<string>('idle');
  const [, setTick] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showSyncLogs, setShowSyncLogs] = useState(false);

  const [cacheHostPath, setCacheHostPath] = useState('');
  const [generatedRestartCommand, setGeneratedRestartCommand] = useState<string | null>(null);
  const [cacheChangeExpanded, setCacheChangeExpanded] = useState(false);

  const [catalogDigests, setCatalogDigests] = useState<{ name: string; url: string; digest: string | null; syncedAt: string | null }[]>([]);
  const [digestsExpanded, setDigestsExpanded] = useState(false);
  /** Snapshot of digest by `catalogName:ocpVersion` taken when sync starts; used to label Updated vs Unchanged after sync. */

  const fetchCatalogDigests = useCallback(async () => {
    try {
      const response = await axios.get('/api/catalogs');
      setCatalogDigests(response.data);
    } catch {
      setCatalogDigests([]);
    }
  }, []);


  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await axios.get('/api/catalogs/sync/status');
      setCatalogSyncStatus(response.data);
      if (response.data.status === 'running' && !syncPollRef.current) {
        syncPollRef.current = setInterval(async () => {
          try {
            const r = await axios.get('/api/catalogs/sync/status');
            setCatalogSyncStatus(r.data);
            if (r.data.status !== 'running' && syncPollRef.current) {
              clearInterval(syncPollRef.current);
              syncPollRef.current = null;
            }
          } catch (e) {
            console.error('Error polling sync status:', e);
          }
        }, 3000);
        if (!elapsedTimerRef.current) {
          elapsedTimerRef.current = setInterval(() => setTick(t => t + 1), 1000);
        }
      } else if (response.data.status !== 'running' && syncPollRef.current) {
        clearInterval(syncPollRef.current);
        syncPollRef.current = null;
      }
    } catch (error) {
      console.error('Error fetching sync status:', error);
    }
  }, []);

  const applyCatalogSettings = (settings: CatalogSettingsResponse, keepDraft = false) => {
    setSupportedOcpVersions(settings.supportedOcpVersions);
    setSavedOcpVersions(settings.enabledOcpVersions);
    // Catalog-only changes must not discard unsaved version checkbox edits.
    if (!keepDraft) setDraftOcpVersions(settings.enabledOcpVersions);
    setExternalCatalogs(settings.externalCatalogs);
    setCatalogSettingsWarning(settings.warning ?? null);
    setCatalogSettingsLoadError(null);
  };

  const fetchCatalogSettings = useCallback(async () => {
    try {
      const response = await axios.get('/api/catalogs/settings');
      applyCatalogSettings(response.data);
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to load catalog settings';
      setCatalogSettingsLoadError(msg);
      addDangerAlert(msg);
    }
  }, [addDangerAlert]);

  useEffect(() => {
    fetchCatalogSettings();
  }, [fetchCatalogSettings]);

  const putCatalogSettings = async (
    enabledOcpVersions: string[],
    catalogs: ExternalCatalogEntry[],
    keepDraft = false,
  ): Promise<CatalogSettingsResponse> => {
    const response = await axios.put('/api/catalogs/settings', {
      enabledOcpVersions,
      externalCatalogs: catalogs.map(({ url, displayName }) => ({ url, displayName })),
    });
    applyCatalogSettings(response.data, keepDraft);
    return response.data;
  };

  const toggleOcpVersion = (version: string, checked: boolean) => {
    setDraftOcpVersions(prev => (checked ? [...prev, version] : prev.filter(v => v !== version)));
  };

  const saveOcpVersions = async () => {
    setSavingCatalogSettings(true);
    try {
      await putCatalogSettings(draftOcpVersions, externalCatalogs);
      addSuccessAlert('Catalog settings saved');
    } catch (error: any) {
      addDangerAlert(error.response?.data?.error || 'Failed to save catalog settings');
    } finally {
      setSavingCatalogSettings(false);
    }
  };

  const addExternalCatalog = async () => {
    const url = newCatalogUrl.trim();
    if (!url) return;
    setSavingCatalogSettings(true);
    let saved: CatalogSettingsResponse;
    try {
      saved = await putCatalogSettings(savedOcpVersions, [
        ...externalCatalogs,
        { url, name: '', tag: '', displayName: newCatalogName.trim() || undefined },
      ], true);
    } catch (error: any) {
      addDangerAlert(error.response?.data?.error || 'Failed to add catalog');
      setSavingCatalogSettings(false);
      return;
    }
    try {
      setNewCatalogUrl('');
      setNewCatalogName('');
      const known = new Set(externalCatalogs.map(c => c.url));
      const added = saved.externalCatalogs.find(c => !known.has(c.url));
      if (added) {
        await startCatalogSync(added.url, 'Catalog was saved, but sync failed to start');
      } else {
        addWarningAlert('Catalog saved but could not auto-start sync; click Sync');
      }
    } finally {
      setSavingCatalogSettings(false);
    }
  };

  const confirmRemoveCatalog = async () => {
    const target = removeCatalogTarget;
    setRemoveCatalogTarget(null);
    if (!target) return;
    setSavingCatalogSettings(true);
    try {
      await putCatalogSettings(savedOcpVersions, externalCatalogs.filter(c => c.url !== target.url), true);
      addSuccessAlert(`Removed ${target.name}`);
      await fetchCatalogDigests();
    } catch (error: any) {
      addDangerAlert(error.response?.data?.error || 'Failed to remove catalog');
    } finally {
      setSavingCatalogSettings(false);
    }
  };

  const startCatalogSync = async (only?: string, failurePrefix?: string): Promise<void> => {
    try {
      await axios.post('/api/catalogs/sync', only ? { only } : undefined);

      setCatalogSyncStatus(prev => ({ ...prev, status: 'running', syncStartTime: new Date().toISOString(), logs: [], error: null, diff: [] }));
      syncPollRef.current = setInterval(fetchSyncStatus, 3000);
      setShowSyncLogs(false);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = setInterval(() => setTick(t => t + 1), 1000);
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to start catalog sync';
      addDangerAlert(failurePrefix ? `${failurePrefix}: ${msg}` : msg);
    }
  };

  useEffect(() => {
    return () => {
      if (syncPollRef.current) clearInterval(syncPollRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const prev = prevSyncStatusRef.current;
    const curr = catalogSyncStatus.status;
    if (prev === 'running' && (curr === 'completed' || curr === 'failed')) {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }
    if (prev === 'running' && curr === 'completed') {
      if (catalogSyncStatus.error) {
        addWarningAlert(catalogSyncStatus.error);
      } else {
        addSuccessAlert(`Catalog sync completed: ${catalogSyncStatus.successCount}/${catalogSyncStatus.totalCount} catalogs successful`);
      }
      setDigestsExpanded(true);
      fetchCatalogDigests();
    } else if (prev === 'running' && curr === 'failed') {
      addDangerAlert(`Catalog sync failed: ${catalogSyncStatus.error || 'Unknown error'}`);
    }
    prevSyncStatusRef.current = curr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogSyncStatus.status]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [catalogSyncStatus.logs.length]);

  const clearSyncData = async () => {
    try {
      const response = await axios.delete('/api/catalogs/sync/data');
      addSuccessAlert(response.data.message);
      await fetchSyncStatus();
      await fetchCatalogDigests();
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to clear sync data';
      addDangerAlert(msg);
    }
  };

  const formatElapsed = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const fetchRegistries = async () => {
    try {
      const response = await axios.get('/api/registries');
      setRegistries(response.data.registries || []);
    } catch (error) {
      console.error('Error fetching registries:', error);
    }
  };

  const verifyRegistry = async (registry: string) => {
    setRegistries(prev => prev.map(r =>
      r.registry === registry ? { ...r, status: 'verifying' as const } : r,
    ));
    try {
      const response = await axios.post('/api/registries/verify', { registry });
      setRegistries(prev => prev.map(r =>
        r.registry === registry ? { ...r, status: response.data.status, error: response.data.error } : r,
      ));
    } catch {
      setRegistries(prev => prev.map(r =>
        r.registry === registry ? { ...r, status: 'failed' as const, error: 'Verification request failed' } : r,
      ));
    }
  };

  const verifyAllRegistries = async () => {
    for (const r of registries) {
      await verifyRegistry(r.registry);
    }
  };

  const fetchPullSecretStatus = async () => {
    try {
      const [statusRes, contentRes] = await Promise.all([
        axios.get('/api/pull-secret/status'),
        axios.get('/api/pull-secret/content'),
      ]);
      setPullSecretStatus(statusRes.data);
      if (contentRes.data.content) {
        setPullSecretContent(contentRes.data.content);
      }
    } catch (error) {
      console.error('Error fetching pull secret status:', error);
    }
  };

  const savePullSecret = async () => {
    try {
      setLoading(true);
      if (!pullSecretContent.trim()) {
        await axios.delete('/api/pull-secret');
        addSuccessAlert('Pull secret removed successfully!');
      } else {
        await axios.post('/api/pull-secret', { content: pullSecretContent });
        addSuccessAlert('Pull secret saved successfully!');
      }
      setPullSecretFilename('');
      await fetchPullSecretStatus();
      await fetchRegistries();
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to save pull secret';
      addDangerAlert(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemInfo();
    fetchPullSecretStatus();
    fetchRegistries();
    fetchSyncStatus();
    fetchCatalogDigests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSystemInfo = async () => {
    try {
      const response = await axios.get('/api/system/info');
      setSystemInfo(response.data);
    } catch (error) {
      console.error('Error fetching system info:', error);
    }
  };

  const generateRestartCommand = () => {
    const trimmed = cacheHostPath.trim();
    if (!trimmed) {
      addDangerAlert('Enter a host path for the cache directory.');
      return;
    }
    const cmd = `CACHE_DIR=${shellSingleQuote(trimmed)} ./mirror-gui.sh --restart`;
    setGeneratedRestartCommand(cmd);
  };

  const copyRestartCommand = async () => {
    if (!generatedRestartCommand) return;
    try {
      await navigator.clipboard.writeText(generatedRestartCommand);
      addSuccessAlert('Command copied to clipboard');
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = generatedRestartCommand;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        addSuccessAlert('Command copied to clipboard');
      } catch {
        addDangerAlert('Could not copy to clipboard');
      }
      document.body.removeChild(textArea);
    }
  };

  const cleanupCache = async () => {
    try {
      setLoading(true);
      await axios.post('/api/cache/cleanup');
      addSuccessAlert('Cache cleaned up successfully!');
      await fetchSystemInfo();
    } catch (error) {
      console.error('Error cleaning up cache:', error);
      addDangerAlert('Failed to cleanup cache');
    } finally {
      setLoading(false);
    }
  };


  const formatBytes = (bytes: string | number) => {
    if (!bytes) return 'Unknown';
    const numBytes = typeof bytes === 'string' ? parseFloat(bytes) : bytes;
    if (isNaN(numBytes)) return String(bytes);
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(numBytes) / Math.log(1024));
    return `${(numBytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <div>
      <Card>
        <CardBody>
          <Title headingLevel="h2">
            <CogIcon /> Settings
          </Title>
          <p>Configure application settings and environment preferences.</p>
        </CardBody>
      </Card>

      <Card className="pf-v6-u-mt-lg">
        <CardBody>
          <Tabs
            activeKey={activeTab}
            onSelect={(_event, tabIndex) => setActiveTab(tabIndex)}
            aria-label="Settings tabs"
          >
            <Tab
              eventKey="pull-secret"
              title={<TabTitleText><KeyIcon /> Pull Secret</TabTitleText>}
            >
              <div className="pf-v6-u-py-lg">
                <Title headingLevel="h3" className="pf-v6-u-mb-md">Pull Secret</Title>

                <Alert
                  variant={pullSecretStatus.detected ? 'success' : 'warning'}
                  isInline
                  isPlain
                  title={pullSecretStatus.detected ? 'Pull secret detected' : 'No pull secret detected'}
                  className="pf-v6-u-mb-lg"
                >
                  {pullSecretStatus.detected
                    ? 'You can view and edit the pull secret content below.'
                    : 'Upload or paste your pull secret below to enable mirroring operations.'}
                </Alert>

                <FormGroup label="Value" fieldId="pull-secret-upload">
                  <FileUpload
                    id="pull-secret-upload"
                    type="text"
                    value={pullSecretContent}
                    filename={pullSecretFilename}
                    filenamePlaceholder="Drag and drop a file or browse to upload"
                    onFileInputChange={(_event, file) => {
                      setPullSecretFilename(file.name);
                      const reader = new FileReader();
                      reader.onload = (e) => {
                        const text = e.target?.result as string;
                        setPullSecretContent(text || '');
                      };
                      reader.readAsText(file);
                    }}
                    onDataChange={(_event, value) => setPullSecretContent(value)}
                    onTextChange={(_event, value) => setPullSecretContent(value)}
                    onClearClick={() => {
                      setPullSecretContent('');
                      setPullSecretFilename('');
                    }}
                    browseButtonText="Browse..."
                    allowEditingUploadedText
                  />
                  <HelperText>
                    <HelperTextItem>
                      Drag and drop your pull-secret.json file or paste the content directly.
                      Download from <a href="https://console.redhat.com/openshift/downloads#tool-pull-secret" target="_blank" rel="noreferrer">console.redhat.com</a>.
                    </HelperTextItem>
                  </HelperText>
                </FormGroup>

                <ActionGroup className="pf-v6-u-mt-md">
                  <Button
                    variant="primary"
                    icon={<SaveIcon />}
                    onClick={savePullSecret}
                    isDisabled={loading}
                    isLoading={loading}
                  >
                    Save
                  </Button>
                </ActionGroup>
              </div>
            </Tab>

            <Tab
              eventKey="registry"
              title={<TabTitleText><RegistryIcon /> Registry</TabTitleText>}
            >
              <div className="pf-v6-u-py-lg">
                <Title headingLevel="h3" className="pf-v6-u-mb-md">Registry Authentication</Title>

                {registries.length === 0 ? (
                  <Alert
                    variant="warning"
                    isInline
                    isPlain
                    title="No registries found"
                    className="pf-v6-u-mb-md"
                  >
                    Add a pull secret in the Pull Secret tab to see registry authentication status.
                  </Alert>
                ) : (
                  <>
                    <Table aria-label="Registry authentication status" variant="compact">
                      <Thead>
                        <Tr>
                          <Th>Registry</Th>
                          <Th>Status</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {registries.map((r) => (
                          <Tr key={r.registry}>
                            <Td>{r.registry}</Td>
                            <Td>
                              {r.status === 'authenticated' && (
                                <Label status="success">Authenticated</Label>
                              )}
                              {r.status === 'failed' && (
                                <Popover bodyContent={r.error || 'Authentication failed'} position="left">
                                  <Label status="danger" style={{ cursor: 'pointer' }}>Failed</Label>
                                </Popover>
                              )}
                              {r.status === 'verifying' && (
                                <Label status="info">Verifying...</Label>
                              )}
                              {r.status === 'not_verified' && (
                                <Label color="grey">Not verified</Label>
                              )}
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>

                    <ActionGroup className="pf-v6-u-mt-md">
                      <Button
                        variant="secondary"
                        icon={<SearchIcon />}
                        onClick={verifyAllRegistries}
                        isDisabled={loading}
                        isLoading={loading}
                      >
                        Verify All
                      </Button>
                    </ActionGroup>
                  </>
                )}
              </div>
            </Tab>

            <Tab
              eventKey="cache"
              title={<TabTitleText><DatabaseIcon /> Cache</TabTitleText>}
            >
              <div className="pf-v6-u-py-lg">
                <Title headingLevel="h3" className="pf-v6-u-mb-md">Cache</Title>

                <FormGroup
                  label={
                    <span>
                      Cache Location
                      <Popover
                        position="right"
                        bodyContent="This path reflects the running container (OC_MIRROR_CACHE_DIR / default data volume). To use a different host disk, save a host path below and restart with the generated command so the new directory can be mounted."
                      >
                        <button type="button" aria-label="Cache location info" className="pf-v6-u-ml-xs" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, verticalAlign: 'middle' }}>
                          <InfoCircleIcon />
                        </button>
                      </Popover>
                    </span>
                  }
                  fieldId="cache-location"
                >
                  <Label isCompact>{systemInfo.hostCacheDir || systemInfo.cacheDir || 'Unknown'}</Label>
                </FormGroup>

                <FormGroup label="Cache Size" fieldId="cache-size" className="pf-v6-u-mt-md">
                  <Label isCompact>{formatBytes(systemInfo.cacheSizeBytes)}</Label>
                </FormGroup>

                <ExpandableSection
                  className="pf-v6-u-mt-lg"
                  toggleText="Change Cache Location"
                  isExpanded={cacheChangeExpanded}
                  onToggle={(_e, expanded) => setCacheChangeExpanded(expanded)}
                >
                  <FormGroup label="Host cache path" fieldId="cache-host-path">
                    <TextInput
                      id="cache-host-path"
                      type="text"
                      value={cacheHostPath}
                      onChange={(_e, v) => {
                        setCacheHostPath(v);
                        setGeneratedRestartCommand(null);
                      }}
                      placeholder="/mnt/fast-ssd/mirror-cache"
                    />
                    <HelperText>
                      <HelperTextItem>Directory on the host to mount as the oc-mirror cache (e.g. /mnt/fast-ssd/mirror-cache).</HelperTextItem>
                    </HelperText>
                  </FormGroup>

                  <ActionGroup className="pf-v6-u-mt-md">
                    <Button
                      variant="primary"
                      onClick={generateRestartCommand}
                    >
                      Generate Restart Command
                    </Button>
                  </ActionGroup>

                  {generatedRestartCommand && (
                    <div className="pf-v6-u-mt-md">
                      <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsFlexStart' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <CodeBlock>
                            <CodeBlockCode>{generatedRestartCommand}</CodeBlockCode>
                          </CodeBlock>
                        </div>
                        <Button
                          variant="plain"
                          aria-label="Copy restart command"
                          icon={<CopyIcon />}
                          onClick={() => void copyRestartCommand()}
                          className="pf-v6-u-ml-sm"
                        />
                      </Flex>
                      <Alert
                        variant="success"
                        isInline
                        isPlain
                        title="Run the command above on the host to apply the new cache location."
                        className="pf-v6-u-mt-md"
                      />
                    </div>
                  )}
                </ExpandableSection>

                <ActionGroup className="pf-v6-u-mt-md">
                  <Button
                    variant="secondary"
                    icon={<TrashAltIcon />}
                    onClick={cleanupCache}
                    isDisabled={loading}
                    isLoading={loading}
                    isDanger
                  >
                    Clean Up Cache
                  </Button>
                </ActionGroup>
              </div>
            </Tab>

            <Tab
              eventKey="sync-catalogs"
              title={<TabTitleText><SyncAltIcon /> Sync Catalogs</TabTitleText>}
            >
              <div className="pf-v6-u-py-lg">
                <Title headingLevel="h3" className="pf-v6-u-mb-md">Sync Operator Catalogs</Title>

                <Alert
                  variant={pullSecretStatus.detected ? 'custom' : 'warning'}
                  isInline
                  isPlain
                  customIcon={pullSecretStatus.detected ? <InfoCircleIcon style={{ color: 'var(--pf-t--global--icon--color--regular)' }} /> : undefined}
                  title={pullSecretStatus.detected ? 'Pull secret detected' : 'Pull secret required'}
                  className="pf-v6-u-mb-lg"
                >
                  {pullSecretStatus.detected
                    ? 'Sync will fetch the latest operator catalogs metadata from registry.redhat.io for all supported OCP versions. This process takes several minutes.'
                    : 'A pull secret is required to sync operator catalogs from registry.redhat.io. Please configure one in the Pull Secret tab.'}
                </Alert>

                {catalogSettingsWarning && (
                  <Alert variant="warning" isInline title={catalogSettingsWarning} className="pf-v6-u-mb-md" />
                )}
                {catalogSettingsLoadError && (
                  <Alert
                    variant="danger"
                    isInline
                    title="Could not load catalog settings"
                    className="pf-v6-u-mb-md"
                    actionLinks={<Button variant="link" isInline onClick={fetchCatalogSettings}>Retry</Button>}
                  >
                    {catalogSettingsLoadError}
                  </Alert>
                )}

                <Title headingLevel="h4" className="pf-v6-u-mb-sm">OpenShift versions to sync</Title>
                <Flex gap={{ default: 'gapMd' }} className="pf-v6-u-mb-sm">
                  {supportedOcpVersions.map(version => (
                    <Checkbox
                      key={version}
                      id={`ocp-version-${version}`}
                      label={version}
                      isChecked={draftOcpVersions.includes(version)}
                      isDisabled={catalogSyncStatus.status === 'running'}
                      onChange={(_e, checked) => toggleOcpVersion(version, checked)}
                    />
                  ))}
                </Flex>
                <Button
                  variant="secondary"
                  icon={<SaveIcon />}
                  onClick={saveOcpVersions}
                  isDisabled={
                    draftOcpVersions.length === 0
                    || catalogSyncStatus.status === 'running'
                    || savingCatalogSettings
                  }
                  className="pf-v6-u-mb-lg"
                >
                  Save versions
                </Button>
                {draftOcpVersions.length === 0 && (
                  <HelperText className="pf-v6-u-mb-md">
                    <HelperTextItem variant="error">At least one OCP version must be enabled.</HelperTextItem>
                  </HelperText>
                )}

                <Title headingLevel="h4" className="pf-v6-u-mb-sm">External catalog sources</Title>
                <Flex gap={{ default: 'gapSm' }} className="pf-v6-u-mb-md">
                  <TextInput
                    aria-label="Catalog image URL"
                    placeholder="icr.io/cpopen/datapower-operator-catalog:latest"
                    value={newCatalogUrl}
                    onChange={(_e, value) => setNewCatalogUrl(value)}
                    isDisabled={catalogSyncStatus.status === 'running'}
                    style={{ minWidth: '28rem' }}
                  />
                  <TextInput
                    aria-label="Catalog display name (optional)"
                    placeholder="Display name (optional)"
                    value={newCatalogName}
                    onChange={(_e, value) => setNewCatalogName(value)}
                    isDisabled={catalogSyncStatus.status === 'running'}
                  />
                  <Button
                    variant="primary"
                    onClick={addExternalCatalog}
                    isDisabled={
                      !newCatalogUrl.trim()
                      || catalogSyncStatus.status === 'running'
                      || savingCatalogSettings
                    }
                  >
                    Add catalog
                  </Button>
                </Flex>
                {externalCatalogs.length > 0 && (
                  <Table aria-label="External catalog sources" variant="compact" className="pf-v6-u-mb-lg">
                    <Thead>
                      <Tr>
                        <Th>Name</Th>
                        <Th>Image URL</Th>
                        <Th screenReaderText="Actions" />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {externalCatalogs.map(catalog => (
                        <Tr key={catalog.url}>
                          <Td dataLabel="Name">{catalog.displayName ? `${catalog.displayName} (${catalog.name})` : catalog.name}</Td>
                          <Td dataLabel="Image URL">{catalog.url}</Td>
                          <Td isActionCell>
                            <Button
                              variant="plain"
                              aria-label={`Remove ${catalog.name}`}
                              icon={<TrashAltIcon />}
                              isDisabled={catalogSyncStatus.status === 'running' || savingCatalogSettings}
                              onClick={() => setRemoveCatalogTarget(catalog)}
                            />
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}

                <Modal
                  variant={ModalVariant.small}
                  isOpen={removeCatalogTarget !== null}
                  onClose={() => setRemoveCatalogTarget(null)}
                  aria-label="Confirm catalog removal"
                >
                  <ModalHeader title="Remove catalog source" />
                  <ModalBody>
                    Remove <strong>{removeCatalogTarget?.name}</strong>? Its synced data is deleted from this server.
                  </ModalBody>
                  <ModalFooter>
                    <Button variant="danger" onClick={confirmRemoveCatalog}>Remove</Button>
                    <Button variant="link" onClick={() => setRemoveCatalogTarget(null)}>Cancel</Button>
                  </ModalFooter>
                </Modal>

                {catalogSyncStatus.lastSyncTime && (
                  <FormGroup label="Last Sync" fieldId="last-sync-time" className="pf-v6-u-mb-md">
                    <Label
                      isCompact
                      color={catalogSyncStatus.status === 'completed' ? 'green' : catalogSyncStatus.status === 'failed' ? 'red' : undefined}
                      icon={catalogSyncStatus.status === 'completed' ? <CheckCircleIcon /> : catalogSyncStatus.status === 'failed' ? <TimesCircleIcon /> : undefined}
                    >
                      <Timestamp date={new Date(catalogSyncStatus.lastSyncTime)} tooltip={{ variant: 'default' }} />
                      {catalogSyncStatus.status === 'completed' && ` (${catalogSyncStatus.successCount}/${catalogSyncStatus.totalCount} catalogs)`}
                      {catalogSyncStatus.status === 'failed' && ' (failed)'}
                    </Label>
                  </FormGroup>
                )}

                <Flex gap={{ default: 'gapSm' }} className="pf-v6-u-mt-md">
                  <Button
                    variant="primary"
                    icon={catalogSyncStatus.status !== 'running' ? <SyncAltIcon /> : undefined}
                    onClick={() => startCatalogSync()}
                    isDisabled={!pullSecretStatus.detected || catalogSyncStatus.status === 'running'}
                    isLoading={catalogSyncStatus.status === 'running'}
                  >
                    {catalogSyncStatus.status === 'running' ? 'Syncing Catalogs...' : 'Sync Catalogs'}
                  </Button>
                  {catalogSyncStatus.logs.length > 0 && (
                    <Button
                      variant="secondary"
                      icon={showSyncLogs ? <EyeSlashIcon /> : <EyeIcon />}
                      onClick={() => setShowSyncLogs(prev => !prev)}
                    >
                      {showSyncLogs ? 'Hide Logs' : 'Show Logs'}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    icon={<TrashAltIcon />}
                    onClick={clearSyncData}
                    isDisabled={
                      catalogSyncStatus.status === 'running'
                      || !(catalogSyncStatus.hasRuntimeSyncData ?? false)
                    }
                    isDanger
                  >
                    Clear Sync Data
                  </Button>
                </Flex>

                {catalogSyncStatus.status === 'running' && catalogSyncStatus.totalCount > 0 && (
                  <div className="pf-v6-u-mt-lg">
                    <Progress
                      value={Math.round((catalogSyncStatus.completedCatalogs / catalogSyncStatus.totalCount) * 100)}
                      title="Catalog sync progress"
                      size={ProgressSize.lg}
                      measureLocation={ProgressMeasureLocation.outside}
                      label={`${catalogSyncStatus.completedCatalogs} / ${catalogSyncStatus.totalCount} catalogs`}
                      valueText={`${catalogSyncStatus.completedCatalogs} / ${catalogSyncStatus.totalCount} catalogs`}
                    />
                    <HelperText className="pf-v6-u-mt-xs">
                      <HelperTextItem>
                        {catalogSyncStatus.currentCatalog && `Processing: ${catalogSyncStatus.currentCatalog} | `}
                        Elapsed: {formatElapsed(catalogSyncStatus.syncStartTime ? Math.floor((Date.now() - new Date(catalogSyncStatus.syncStartTime).getTime()) / 1000) : 0)}
                      </HelperTextItem>
                    </HelperText>
                  </div>
                )}

                {catalogSyncStatus.status === 'completed' && catalogSyncStatus.diff.length > 0 && (
                  <div className="pf-v6-u-mt-lg">
                    <Alert variant="success" isInline isPlain title="Catalog changes detected" className="pf-v6-u-mb-md">
                      The following changes were found compared to the previously loaded catalog data.
                    </Alert>
                    {catalogSyncStatus.diff.map((entry) => (
                      <ExpandableSection
                        key={entry.catalog}
                        toggleText={`${entry.catalog} (${entry.newOperators.length} new, ${entry.updatedOperators.length} updated, ${entry.removedOperators.length} removed)`}
                        isIndented
                      >
                        {entry.newOperators.length > 0 && (
                          <div className="pf-v6-u-mb-sm">
                            <Title headingLevel="h5" className="pf-v6-u-mb-xs">
                              <Label color="green" isCompact>New Operators ({entry.newOperators.length})</Label>
                            </Title>
                            <List isPlain>
                              {entry.newOperators.map(op => <ListItem key={op}>{op}</ListItem>)}
                            </List>
                          </div>
                        )}
                        {entry.updatedOperators.length > 0 && (
                          <div className="pf-v6-u-mb-sm">
                            <Title headingLevel="h5" className="pf-v6-u-mb-xs">
                              <Label color="blue" isCompact>Updated Operators ({entry.updatedOperators.length})</Label>
                            </Title>
                            <List isPlain>
                              {entry.updatedOperators.map(op => (
                                <ListItem key={op.name}>
                                  <strong>{op.name}</strong>: {op.addedVersions.join(', ')}
                                </ListItem>
                              ))}
                            </List>
                          </div>
                        )}
                        {entry.removedOperators.length > 0 && (
                          <div className="pf-v6-u-mb-sm">
                            <Title headingLevel="h5" className="pf-v6-u-mb-xs">
                              <Label color="red" isCompact>Removed Operators ({entry.removedOperators.length})</Label>
                            </Title>
                            <List isPlain>
                              {entry.removedOperators.map(op => <ListItem key={op}>{op}</ListItem>)}
                            </List>
                          </div>
                        )}
                      </ExpandableSection>
                    ))}
                  </div>
                )}

                {catalogSyncStatus.status === 'completed' && catalogSyncStatus.diff.length === 0 && (
                  <Alert variant="success" isInline isPlain title="Catalogs are up to date" className="pf-v6-u-mt-lg">
                    No differences found between the synced data and the previously loaded catalogs.
                  </Alert>
                )}

                {catalogDigests.length > 0 && (
                  <ExpandableSection
                    toggleText={`Catalog Digests (${catalogDigests.length})`}
                    isExpanded={digestsExpanded}
                    onToggle={(_e, expanded) => setDigestsExpanded(expanded)}
                    className="pf-v6-u-mt-lg"
                  >
                    <Table variant="compact" borders={false} aria-label="Catalog digests">
                      <Thead>
                        <Tr>
                          <Th>Catalog</Th>
                          <Th>OCP</Th>
                          <Th>Digest</Th>
                          <Th>Updated</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {catalogDigests.map((cat, i) => {
                          const ocp = cat.url.split(':').pop() || '';
                          const isRealDigest = cat.digest?.startsWith('sha256:');
                          const shortDigest = isRealDigest ? `${cat.digest!.slice(0, 19)}...` : '';
                          const digestKey = `${cat.name}:${ocp}`;
                          return (
                            <Tr key={`${digestKey}-${i}`}>
                              <Td>{cat.name}</Td>
                              <Td>{ocp}</Td>
                              <Td>
                                <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }} flexWrap={{ default: 'nowrap' }}>
                                  {isRealDigest ? (
                                    <>
                                      <Tooltip content={cat.digest || ''}>
                                        <Label color="blue" isCompact><span style={{ fontFamily: 'var(--pf-t--global--font--family--mono)' }}>{shortDigest}</span></Label>
                                      </Tooltip>
                                      <Button
                                        variant="plain"
                                        isInline
                                        icon={<CopyIcon />}
                                        onClick={() => {
                                          navigator.clipboard.writeText(cat.digest || '');
                                          addSuccessAlert('Digest copied');
                                        }}
                                        aria-label="Copy digest"
                                        style={{ padding: 0 }}
                                      />
                                    </>
                                  ) : (
                                    <Tooltip content="Built-in catalog data does not include digests. Run Sync Catalogs to fetch them.">
                                      <Label color="orange" isCompact icon={<InfoCircleIcon />}>N/A</Label>
                                    </Tooltip>
                                  )}
                                </Flex>
                              </Td>
                              <Td>
                                {cat.syncedAt
                                  ? <Timestamp date={new Date(cat.syncedAt)} tooltip={{ variant: 'default' }} />
                                  : <span className="pf-v6-u-color-200">Not synced</span>}
                              </Td>
                            </Tr>
                          );
                        })}
                      </Tbody>
                    </Table>
                  </ExpandableSection>
                )}

                {showSyncLogs && catalogSyncStatus.logs.length > 0 && (
                  <div className="pf-v6-u-mt-lg">
                    <div
                      style={{
                        backgroundColor: 'var(--pf-t--global--background--color--secondary--default)',
                        border: '1px solid var(--pf-t--global--border--color--default)',
                        borderRadius: '6px',
                        padding: 'var(--pf-t--global--spacer--sm)',
                        maxHeight: '300px',
                        overflowY: 'auto',
                        fontFamily: 'var(--pf-t--global--font--family--mono)',
                        fontSize: '0.8rem',
                        lineHeight: '1.4',
                      }}
                    >
                      {catalogSyncStatus.logs.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  </div>
                )}
              </div>
            </Tab>

          </Tabs>
        </CardBody>
      </Card>

    </div>
  );
};

export default SettingsPage;
