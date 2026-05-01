import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  Card,
  CardBody,
  CardTitle,
  CardHeader,
  Tabs,
  Tab,
  TabTitleText,
  FormGroup,
  TextInput,
  Switch,
  Button,
  ActionGroup,
  FileUpload,
  Grid,
  GridItem,
  Spinner,
  Title,
  HelperText,
  HelperTextItem,
  Alert,
  Label,
  Popover,
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
  GlobeIcon,
  SaveIcon,
  UndoIcon,
  SearchIcon,
  TrashAltIcon,
  PencilAltIcon,
  InfoCircleIcon,
  CheckCircleIcon,
  TimesCircleIcon,
  InProgressIcon,
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

interface ProxySettings {
  enabled: boolean;
  host: string;
  port: string;
  username: string;
  password: string;
}

interface Settings {
  maxConcurrentOperations: number;
  logRetentionDays: number;
  autoCleanup: boolean;
  proxySettings: ProxySettings;
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

const defaultSettings: Settings = {
  maxConcurrentOperations: 1,
  logRetentionDays: 30,
  autoCleanup: true,
  proxySettings: {
    enabled: false,
    host: '',
    port: '',
    username: '',
    password: '',
  },
};

const SettingsPage: React.FC = () => {
  const { addSuccessAlert, addDangerAlert } = useAlerts();

  const [settings, setSettings] = useState<Settings>({ ...defaultSettings });
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
  const [showResetModal, setShowResetModal] = useState(false);
  const [pullSecretContent, setPullSecretContent] = useState('');
  const [pullSecretFilename, setPullSecretFilename] = useState('');
  const [pullSecretStatus, setPullSecretStatus] = useState<{ detected: boolean; path: string | null }>({ detected: false, path: null });
  const [editingCacheLocation, setEditingCacheLocation] = useState(false);
  const [cacheLocationInput, setCacheLocationInput] = useState('');
  const [registries, setRegistries] = useState<RegistryEntry[]>([]);

  const fetchRegistries = async () => {
    try {
      const response = await axios.get('/api/registries');
      const entries = (response.data.registries || []).map((r: RegistryEntry) => ({
        ...r,
        status: 'not_verified' as const,
      }));
      setRegistries(entries);
    } catch (error) {
      console.error('Error fetching registries:', error);
    }
  };

  const verifyRegistry = async (registry: string) => {
    setRegistries(prev => prev.map(r =>
      r.registry === registry ? { ...r, status: 'verifying' as const } : r
    ));
    try {
      const response = await axios.post('/api/registries/verify', { registry });
      setRegistries(prev => prev.map(r =>
        r.registry === registry ? { ...r, status: response.data.status, error: response.data.error } : r
      ));
    } catch (error) {
      setRegistries(prev => prev.map(r =>
        r.registry === registry ? { ...r, status: 'failed' as const, error: 'Verification request failed' } : r
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
    fetchSettings();
    fetchSystemInfo();
    fetchPullSecretStatus();
    fetchRegistries();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await axios.get('/api/settings');
      setSettings(response.data);
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  };

  const fetchSystemInfo = async () => {
    try {
      const response = await axios.get('/api/system/info');
      setSystemInfo(response.data);
    } catch (error) {
      console.error('Error fetching system info:', error);
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

  const saveCacheLocation = async () => {
    try {
      setLoading(true);
      await axios.put('/api/cache/location', { cacheDir: cacheLocationInput });
      addSuccessAlert('Cache location updated!');
      setEditingCacheLocation(false);
      await fetchSystemInfo();
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to update cache location';
      addDangerAlert(msg);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setLoading(true);
      await axios.post('/api/settings', settings);
      addSuccessAlert('Settings saved successfully!');
    } catch (error) {
      console.error('Error saving settings:', error);
      addDangerAlert('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };


  const resetSettings = () => {
    setSettings({ ...defaultSettings });
    addSuccessAlert('Settings reset to defaults');
    setShowResetModal(false);
  };

  const updateSetting = (path: string, value: string | number | boolean) => {
    const keys = path.split('.');
    setSettings(prev => {
      const newSettings = JSON.parse(JSON.stringify(prev)) as Settings;
      let current: Record<string, unknown> = newSettings as unknown as Record<string, unknown>;
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]] as Record<string, unknown>;
      }
      current[keys[keys.length - 1]] = value;
      return newSettings;
    });
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
          <p>Configure application settings and system preferences.</p>
        </CardBody>
      </Card>

      <Card style={{ marginTop: '1rem' }}>
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
              <div style={{ padding: '1.5rem 0' }}>
                <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>Pull Secret</Title>

                <Alert
                  variant={pullSecretStatus.detected ? 'success' : 'warning'}
                  isInline
                  isPlain
                  title={pullSecretStatus.detected ? 'Pull secret detected' : 'No pull secret detected'}
                  style={{ marginBottom: '1.5rem' }}
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

                <ActionGroup style={{ marginTop: '1rem' }}>
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
              eventKey="cache"
              title={<TabTitleText><DatabaseIcon /> Cache</TabTitleText>}
            >
              <div style={{ padding: '1.5rem 0' }}>
                <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>Cache</Title>

                <FormGroup
                  label={
                    <span>
                      Cache Location
                      <Popover
                        position="right"
                        bodyContent="Specify the absolute path to an existing directory on the host (e.g. /home/user/mirror-data/cache)."
                      >
                        <button type="button" aria-label="Cache location info" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: '0.25rem', verticalAlign: 'middle' }}>
                          <InfoCircleIcon />
                        </button>
                      </Popover>
                    </span>
                  }
                  fieldId="cache-location"
                >
                  {editingCacheLocation ? (
                    <Grid hasGutter>
                      <GridItem span={8}>
                        <TextInput
                          id="cache-location"
                          value={cacheLocationInput}
                          onChange={(_event, value) => setCacheLocationInput(value)}
                          placeholder="/absolute/path/to/cache"
                        />
                      </GridItem>
                      <GridItem span={4}>
                        <Button
                          variant="primary"
                          icon={<SaveIcon />}
                          onClick={saveCacheLocation}
                          isDisabled={loading || !cacheLocationInput.trim()}
                          isLoading={loading}
                          style={{ marginRight: '0.5rem' }}
                        >
                          Save
                        </Button>
                        <Button
                          variant="link"
                          onClick={() => setEditingCacheLocation(false)}
                        >
                          Cancel
                        </Button>
                      </GridItem>
                    </Grid>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Label isCompact>{systemInfo.hostCacheDir || systemInfo.cacheDir || 'Unknown'}</Label>
                      <Button
                        variant="plain"
                        icon={<PencilAltIcon />}
                        onClick={() => {
                          setCacheLocationInput(systemInfo.hostCacheDir || systemInfo.cacheDir || '');
                          setEditingCacheLocation(true);
                        }}
                        aria-label="Edit cache location"
                      />
                    </div>
                  )}
                </FormGroup>

                <FormGroup label="Cache Size" fieldId="cache-size" style={{ marginTop: '1rem' }}>
                  <Label isCompact>{formatBytes(systemInfo.cacheSizeBytes)}</Label>
                </FormGroup>

                <ActionGroup style={{ marginTop: '1.5rem' }}>
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
              eventKey="registry"
              title={<TabTitleText><RegistryIcon /> Registry</TabTitleText>}
            >
              <div style={{ padding: '1.5rem 0' }}>
                <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>Registry Authentication</Title>

                {registries.length === 0 ? (
                  <Alert
                    variant="warning"
                    isInline
                    isPlain
                    title="No registries found"
                    style={{ marginBottom: '1rem' }}
                  >
                    Add a pull secret in the Pull Secret tab to see registry authentication status.
                  </Alert>
                ) : (
                  <>
                    <Table aria-label="Registry authentication status" variant="compact">
                      <Thead>
                        <Tr>
                          <Th>Registry</Th>
                          <Th>Username</Th>
                          <Th>Status</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {registries.map((r) => (
                          <Tr key={r.registry}>
                            <Td>{r.registry}</Td>
                            <Td>{r.username || '-'}</Td>
                            <Td>
                              {r.status === 'authenticated' && (
                                <Label color="green" icon={<CheckCircleIcon />}>Authenticated</Label>
                              )}
                              {r.status === 'failed' && (
                                <Popover bodyContent={r.error || 'Authentication failed'} position="left">
                                  <Label color="red" icon={<TimesCircleIcon />} style={{ cursor: 'pointer' }}>Failed</Label>
                                </Popover>
                              )}
                              {r.status === 'verifying' && (
                                <Label color="blue" icon={<InProgressIcon />}>Verifying...</Label>
                              )}
                              {r.status === 'not_verified' && (
                                <Label color="grey">Not verified</Label>
                              )}
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>

                    <ActionGroup style={{ marginTop: '1.5rem' }}>
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
              eventKey="proxy"
              title={<TabTitleText><GlobeIcon /> Proxy</TabTitleText>}
            >
              <div style={{ padding: '1.5rem 0' }}>
                <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>Proxy Settings</Title>

                <FormGroup label="Enable Proxy" fieldId="proxy-enabled">
                  <Switch
                    id="proxy-enabled"
                    label={settings.proxySettings.enabled ? 'Enabled' : 'Disabled'}
                    isChecked={settings.proxySettings.enabled}
                    onChange={(_event, checked) => updateSetting('proxySettings.enabled', checked)}
                  />
                </FormGroup>

                {settings.proxySettings.enabled && (
                  <>
                    <Grid hasGutter style={{ marginTop: '1rem' }}>
                      <GridItem span={8}>
                        <FormGroup label="Proxy Host" fieldId="proxy-host">
                          <TextInput
                            id="proxy-host"
                            value={settings.proxySettings.host}
                            onChange={(_event, value) => updateSetting('proxySettings.host', value)}
                            placeholder="proxy.example.com"
                          />
                        </FormGroup>
                      </GridItem>
                      <GridItem span={4}>
                        <FormGroup label="Proxy Port" fieldId="proxy-port">
                          <TextInput
                            id="proxy-port"
                            type="number"
                            value={settings.proxySettings.port}
                            onChange={(_event, value) => updateSetting('proxySettings.port', value)}
                            placeholder="8080"
                          />
                        </FormGroup>
                      </GridItem>
                    </Grid>

                    <Grid hasGutter style={{ marginTop: '1rem' }}>
                      <GridItem span={6}>
                        <FormGroup label="Proxy Username (optional)" fieldId="proxy-username">
                          <TextInput
                            id="proxy-username"
                            value={settings.proxySettings.username}
                            onChange={(_event, value) => updateSetting('proxySettings.username', value)}
                            placeholder="proxy_username"
                          />
                        </FormGroup>
                      </GridItem>
                      <GridItem span={6}>
                        <FormGroup label="Proxy Password (optional)" fieldId="proxy-password">
                          <TextInput
                            id="proxy-password"
                            type="password"
                            value={settings.proxySettings.password}
                            onChange={(_event, value) => updateSetting('proxySettings.password', value)}
                            placeholder="proxy_password"
                          />
                        </FormGroup>
                      </GridItem>
                    </Grid>
                  </>
                )}
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>

      <Card style={{ marginTop: '1rem' }}>
        <CardBody>
          <Title headingLevel="h3" style={{ marginBottom: '1rem' }}>Actions</Title>
          <ActionGroup>
            <Button
              variant="primary"
              icon={loading ? <Spinner size="md" /> : <SaveIcon />}
              onClick={saveSettings}
              isDisabled={loading}
              isLoading={loading}
            >
              Save Settings
            </Button>
            <Button
              variant="secondary"
              icon={<UndoIcon />}
              onClick={() => setShowResetModal(true)}
              isDisabled={loading}
            >
              Reset to Defaults
            </Button>
          </ActionGroup>
        </CardBody>
      </Card>

      <Modal
        variant={ModalVariant.small}
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        aria-labelledby="reset-settings-title"
      >
        <ModalHeader labelId="reset-settings-title" title="Reset Settings" />
        <ModalBody>
          Are you sure you want to reset all settings to default values?
          <br /><br />
          <Alert variant="warning" isInline isPlain title="This will discard any unsaved changes." />
        </ModalBody>
        <ModalFooter>
          <Button key="confirm" variant="danger" onClick={resetSettings}>
            Reset
          </Button>
          <Button key="cancel" variant="link" onClick={() => setShowResetModal(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default SettingsPage;
