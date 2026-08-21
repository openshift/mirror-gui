import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import YAML from 'yaml';
import { useAlerts } from '../AlertContext';
import YamlHighlighter from './YamlHighlighter';
import {
  Alert,
  AlertVariant,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  CardTitle,
  FileUpload,
  Flex,
  FlexItem,
  FormGroup,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  Label,
  Popover,
  Spinner,
  Split,
  SplitItem,
  Tab,
  Tabs,
  TabTitleIcon,
  TabTitleText,
  TextInput,
  Title,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Select,
  SelectGroup,
  SelectOption,
  SelectList,
  MenuToggle,
  Tooltip,
  NumberInput,
  Switch,
} from '@patternfly/react-core';
import { TimesIcon } from '@patternfly/react-icons';
import {
  ServerIcon,
  CogIcon,
  CubesIcon,
  EyeIcon,
  UploadIcon,
  PlusCircleIcon,
  MinusCircleIcon,
  CopyIcon,
  DownloadIcon,
  InfoCircleIcon,
  SaveIcon,
  ArrowRightIcon,
  PencilAltIcon,
  CheckIcon,
} from '@patternfly/react-icons';
import { FieldBuilder } from '@patternfly/react-component-groups';
import { TypeaheadSelect, TypeaheadSelectOption } from '@patternfly/react-templates';

interface PlatformChannel {
  name: string;
  minVersion: string;
  maxVersion: string;
  type: string;
  shortestPath: boolean;
}

interface OperatorChannel {
  name: string;
  minVersion: string;
  maxVersion: string;
}

interface OperatorPackage {
  name: string;
  channels: OperatorChannel[];
  isDependency?: boolean;
  autoAddedBy?: string;
}

interface OperatorCatalog {
  catalog: string;
  catalogVersion?: string;
  availableOperators?: string[];
  packages: OperatorPackage[];
}

interface ImageSetConfig {
  kind: string;
  apiVersion: string;
  archiveSize: string;
  mirror: {
    platform: {
      channels: PlatformChannel[];
      graph: boolean;
    };
    operators: OperatorCatalog[];
    additionalImages: { name: string }[];
    helm: { repositories: never[] };
  };
}

interface CatalogInfo {
  name: string;
  url: string;
  description: string;
  digest?: string | null;
  syncedAt?: string | null;
}

interface DetailedOperator {
  name: string;
  defaultChannel: string;
  allChannels: string[];
}

interface CleanChannel {
  name: string;
  type?: string;
  minVersion?: string;
  maxVersion?: string;
  shortestPath?: boolean;
}

interface CleanOperatorChannel {
  name: string;
  minVersion?: string;
  maxVersion?: string;
}

interface CleanConfig {
  kind: string;
  apiVersion: string;
  archiveSize?: number;
  mirror: {
    platform?: Record<string, unknown>;
    operators?: {
      catalog: string;
      packages: {
        name: string;
        defaultChannel?: string;
        channels: CleanOperatorChannel[];
      }[];
    }[];
    additionalImages?: { name: string }[];
  };
}

type VersionField = 'minVersion' | 'maxVersion';

const OCP_VERSIONS = ['4.16', '4.17', '4.18', '4.19', '4.20', '4.21', '4.22'];

const FALLBACK_CATALOGS: CatalogInfo[] = [
  {
    name: 'redhat-operator-index',
    url: 'registry.redhat.io/redhat/redhat-operator-index',
    description: 'Red Hat certified operators',
  },
  {
    name: 'certified-operator-index',
    url: 'registry.redhat.io/redhat/certified-operator-index',
    description: 'Certified operators from partners',
  },
  {
    name: 'community-operator-index',
    url: 'registry.redhat.io/redhat/community-operator-index',
    description: 'Community operators',
  },
];

const versionToNumber = (version: string): number => {
  const parts = version.split('.').map(p => parseInt(p, 10) || 0);
  return parts[0] * 1_000_000 + (parts[1] || 0) * 1_000 + (parts[2] || 0);
};

const isValidVersion = (version: string): boolean => {
  if (!version) return false;
  return /\d/.test(version) && version.includes('.');
};

const validateVersionRange = (
  minVersion: string,
  maxVersion: string,
  versions: string[],
): { isValid: boolean; message: string } => {
  if (!minVersion && !maxVersion) return { isValid: true, message: '' };

  if (versions.length > 0 && minVersion && maxVersion) {
    const minIdx = versions.indexOf(minVersion);
    const maxIdx = versions.indexOf(maxVersion);
    if (minIdx !== -1 && maxIdx !== -1 && minIdx > maxIdx) {
      return { isValid: false, message: 'Min version cannot be greater than max version' };
    }
    if (minIdx !== -1 && maxIdx !== -1) {
      const hasValid = versions.some((_, i) => i >= minIdx && i <= maxIdx);
      if (!hasValid) {
        return {
          isValid: false,
          message: `No versions available in range ${minVersion} to ${maxVersion}`,
        };
      }
    }
    return { isValid: true, message: '' };
  }

  const minNum = minVersion ? versionToNumber(minVersion) : 0;
  const maxNum = maxVersion ? versionToNumber(maxVersion) : Number.MAX_SAFE_INTEGER;

  if (minNum > maxNum) {
    return { isValid: false, message: 'Min version cannot be greater than max version' };
  }

  if (versions.length > 0) {
    const hasValid = versions.some(v => {
      const n = versionToNumber(v);
      return n >= minNum && n <= maxNum;
    });
    if (!hasValid) {
      return {
        isValid: false,
        message: `No versions available in range ${minVersion || '0.0.0'} to ${maxVersion || 'latest'}`,
      };
    }
  }

  return { isValid: true, message: '' };
};

const getMajorMinor = (version: string): string => {
  const parts = version.split('.');
  return `${parts[0]}.${parts[1]}`;
};

const getChannelVersionLine = (channelName: string): string | undefined => {
  const match = channelName.match(/(\d+\.\d+)/);
  return match ? match[1] : undefined;
};

const getPlatformChannelValidationMessage = (channel: PlatformChannel): string => {
  const channelLine = getChannelVersionLine(channel.name);

  if (channel.minVersion) {
    if (!isValidVersion(channel.minVersion)) {
      return 'Min version must be a valid version like 4.16.0';
    }
    if (channelLine && getMajorMinor(channel.minVersion) !== channelLine) {
      return `Min version must match channel ${channelLine}.x (e.g., ${channelLine}.0)`;
    }
  }

  if (channel.maxVersion) {
    if (!isValidVersion(channel.maxVersion)) {
      return 'Max version must be a valid version like 4.16.0';
    }
    if (channelLine && getMajorMinor(channel.maxVersion) !== channelLine) {
      return `Max version must match channel ${channelLine}.x (e.g., ${channelLine}.0)`;
    }
  }

  if (channel.minVersion && channel.maxVersion) {
    const validation = validateVersionRange(channel.minVersion, channel.maxVersion, []);
    if (!validation.isValid) {
      return validation.message;
    }
  }

  return '';
};

const getOperatorChannelFieldErrors = (
  channel: OperatorChannel,
  versions: string[],
): { minVersion: string; maxVersion: string } => {
  const minError = channel.minVersion && !isValidVersion(channel.minVersion)
    ? 'Min version must be a valid version'
    : '';
  const maxError = channel.maxVersion && !isValidVersion(channel.maxVersion)
    ? 'Max version must be a valid version'
    : '';

  if (minError || maxError) return { minVersion: minError, maxVersion: maxError };

  const validation = validateVersionRange(channel.minVersion, channel.maxVersion, versions);
  if (!validation.isValid) return { minVersion: validation.message, maxVersion: validation.message };

  return { minVersion: '', maxVersion: '' };
};

const getSelectableVersions = (
  versions: string[],
  field: VersionField,
  otherVersion: string,
): string[] => {
  if (!otherVersion) return versions;

  const otherVersionNumber = versionToNumber(otherVersion);
  return versions.filter(version =>
    field === 'minVersion'
      ? versionToNumber(version) <= otherVersionNumber
      : versionToNumber(version) >= otherVersionNumber,
  );
};

const sanitizeArchiveSizeInput = (value: string): string => {
  const digitsOnly = value.replace(/\D+/g, '');
  return digitsOnly.replace(/^0+/, '');
};

const getImageNameWarning = (name: string): string => {
  if (!name.trim()) return '';
  if (name.includes(' ')) return 'Image name should not contain spaces';
  if (!name.includes('/')) return 'Image name should include a registry (e.g. registry.redhat.io/namespace/image)';
  if (!name.includes(':') && !name.includes('@')) return 'Consider adding a tag or digest (e.g. :latest or @sha256:...)';
  return '';
};

const getArchiveSizeValidationMessage = (value: string): string => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '';
  }

  if (!/^\d+$/.test(trimmedValue)) {
    return 'Archive size must contain digits only';
  }

  if (Number.parseInt(trimmedValue, 10) <= 0) {
    return 'Archive size must be greater than 0';
  }

  return '';
};

const clearMismatchedPlatformVersions = (channel: PlatformChannel): PlatformChannel => {
  const channelLine = getChannelVersionLine(channel.name);
  if (!channelLine) return channel;

  return {
    ...channel,
    minVersion:
      channel.minVersion &&
      isValidVersion(channel.minVersion) &&
      getMajorMinor(channel.minVersion) !== channelLine
        ? ''
        : channel.minVersion,
    maxVersion:
      channel.maxVersion &&
      isValidVersion(channel.maxVersion) &&
      getMajorMinor(channel.maxVersion) !== channelLine
        ? ''
        : channel.maxVersion,
  };
};

const sanitizePlatformChannelValue = (
  channel: PlatformChannel,
  field: VersionField,
): { channel: PlatformChannel; message: string } => {
  const value = channel[field];
  if (!value) {
    return { channel, message: '' };
  }

  const channelLine = getChannelVersionLine(channel.name);
  const label = field === 'minVersion' ? 'Min version' : 'Max version';

  if (!isValidVersion(value)) {
    return {
      channel: { ...channel, [field]: '' },
      message: `${label} must be a valid version like ${channelLine ? `${channelLine}.0` : '4.16.0'}`,
    };
  }

  if (channelLine && getMajorMinor(value) !== channelLine) {
    return {
      channel: { ...channel, [field]: '' },
      message: `${label} must match channel ${channelLine}.x (e.g., ${channelLine}.0)`,
    };
  }

  const otherField: VersionField = field === 'minVersion' ? 'maxVersion' : 'minVersion';
  const otherValue = channel[otherField];

  if (otherValue && isValidVersion(otherValue)) {
    const validation = validateVersionRange(
      field === 'minVersion' ? value : otherValue,
      field === 'maxVersion' ? value : otherValue,
      [],
    );

    if (!validation.isValid) {
      return {
        channel: { ...channel, [field]: '' },
        message: validation.message,
      };
    }
  }

  return { channel, message: '' };
};

const InfoPopoverButton = ({
  ariaLabel,
  bodyContent,
}: {
  ariaLabel: string;
  bodyContent: React.ReactNode;
}) => (
  <Popover bodyContent={bodyContent}>
    <Button
      variant="plain"
      aria-label={ariaLabel}
      hasNoPadding
      type="button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 'auto',
        height: '1.25rem',
        lineHeight: 1,
        color: 'var(--pf-t--global--text--color--regular, #151515)',
      }}
    >
      <InfoCircleIcon style={{ fontSize: '0.875rem' }} />
    </Button>
  </Popover>
);

const generateDefaultConfigName = (): string => {
  const now = new Date();
  const dateStr = now
    .toISOString()
    .replace(/T/, '-')
    .replace(/\..+/, '')
    .replace(/:/g, '-');
  return `imageset-config-${dateStr}-UTC.yaml`;
};

const MirrorConfig: React.FC = () => {
  const { addSuccessAlert, addDangerAlert, addInfoAlert } = useAlerts();

  const [config, setConfig] = useState<ImageSetConfig>({
    kind: 'ImageSetConfiguration',
    apiVersion: 'mirror.openshift.io/v2alpha1',
    archiveSize: '',
    mirror: {
      platform: { channels: [], graph: true },
      operators: [],
      additionalImages: [],
      helm: { repositories: [] },
    },
  });

  const [availableCatalogs, setAvailableCatalogs] = useState<CatalogInfo[]>([]);
  const [detailedOperators, setDetailedOperators] = useState<Record<string, DetailedOperator[]>>({});
  const [operatorChannels, setOperatorChannels] = useState<Record<string, string[]>>({});
  const [availableVersions, setAvailableVersions] = useState<Record<string, string[]>>({});

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string | number>('platform');
  const [customConfigName, setCustomConfigName] = useState('');
  const [isEditingPreview, setIsEditingPreview] = useState(false);
  const [editedYaml, setEditedYaml] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const setFieldError = (key: string, message: string) => {
    setValidationErrors(prev => ({ ...prev, [key]: message }));
  };

  const clearFieldError = (key: string) => {
    setValidationErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const clearAllErrors = () => setValidationErrors({});

  const [channelSelectOpen, setChannelSelectOpen] = useState<Record<number, boolean>>({});
  const [catalogSelectOpen, setCatalogSelectOpen] = useState<Record<number, boolean>>({});
  const [opChannelSelectOpen, setOpChannelSelectOpen] = useState<Record<string, boolean>>({});

  const [uploadFilename, setUploadFilename] = useState('');
  const [uploadedContent, setUploadedContent] = useState('');
  const [parsedUpload, setParsedUpload] = useState<Record<string, any> | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [isUploadLoading, setIsUploadLoading] = useState(false);

  const [useDigestRef, setUseDigestRef] = useState(false);

  const catalogDigestMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cat of availableCatalogs) {
      if (cat.digest && cat.digest.startsWith('sha256:')) {
        map[cat.url] = cat.digest;
      }
    }
    return map;
  }, [availableCatalogs]);

  const hasAnyDigest = Object.keys(catalogDigestMap).length > 0;

  const digestValidationResults = useMemo(() => {
    if (!parsedUpload?.mirror?.operators) return [];
    const results: { catalog: string; name: string; ocp: string; status: 'match' | 'mismatch' | 'unknown'; syncedDigest?: string; configDigest?: string }[] = [];
    for (const op of parsedUpload.mirror.operators) {
      const catalogRef: string = op.catalog || '';
      if (!catalogRef.includes('@sha256:')) continue;
      const [baseUrl, configDigest] = catalogRef.split('@');
      const namePart = baseUrl.split('/').pop() || '';
      const matchingCatalogs = availableCatalogs.filter(c =>
        c.url.includes(namePart),
      );
      if (matchingCatalogs.length === 0) {
        results.push({ catalog: catalogRef, name: namePart, ocp: 'unknown', status: 'unknown', configDigest });
        continue;
      }
      const exactMatch = matchingCatalogs.find(c => c.digest === configDigest);
      if (exactMatch) {
        const ocp = exactMatch.url.split(':').pop() || 'unknown';
        results.push({ catalog: catalogRef, name: namePart, ocp, status: 'match', syncedDigest: exactMatch.digest ?? undefined, configDigest });
      } else {
        const withDigest = matchingCatalogs.filter(c => c.digest && c.digest !== 'unknown');
        if (withDigest.length === 0) {
          results.push({ catalog: catalogRef, name: namePart, ocp: 'unknown', status: 'unknown', configDigest });
        } else {
          const versions = withDigest.map(c => c.url.split(':').pop() || '?').join(', ');
          results.push({ catalog: catalogRef, name: namePart, ocp: versions, status: 'mismatch', syncedDigest: `none of ${withDigest.length} versions matched`, configDigest });
        }
      }
    }
    return results;
  }, [parsedUpload, availableCatalogs]);

  const operatorCatalogs: CatalogInfo[] =
    availableCatalogs.length > 0 ? availableCatalogs : FALLBACK_CATALOGS;

  const operatorCatalogsByVersion = useMemo(() => {
    return operatorCatalogs.reduce<Record<string, CatalogInfo[]>>((catalogsByVersion, catalog) => {
      const version = catalog.url.includes(':') ? catalog.url.split(':').pop()! : 'Unversioned';
      (catalogsByVersion[version] ||= []).push(catalog);
      return catalogsByVersion;
    }, {});
  }, [operatorCatalogs]);

  const fetchAvailableData = useCallback(async () => {
    try {
      setLoading(true);
      const catalogsRes = await axios.get('/api/catalogs');
      setAvailableCatalogs(catalogsRes.data);
    } catch (error) {
      console.error('Error fetching available data:', error);
      addDangerAlert('Failed to load available channels and operators');
    } finally {
      setLoading(false);
    }
  }, [addDangerAlert]);

  useEffect(() => {
    fetchAvailableData();
  }, [fetchAvailableData]);

  const fetchOperatorsForCatalog = async (catalogUrl: string): Promise<string[]> => {
    try {
      const response = await axios.get(
        `/api/operators?catalog=${encodeURIComponent(catalogUrl)}&detailed=true`,
      );
      const detailedOps: DetailedOperator[] = response.data;
      setDetailedOperators(prev => ({ ...prev, [catalogUrl]: detailedOps }));
      return detailedOps.map(op => op.name);
    } catch (error) {
      console.error('Error fetching operators for catalog:', error);
      return [];
    }
  };

  const fetchOperatorChannels = async (
    operatorName: string,
    catalogUrl: string,
  ): Promise<string[]> => {
    const key = `${operatorName}:${catalogUrl}`;
    if (operatorChannels[key]) return operatorChannels[key];

    try {
      const response = await axios.get(
        `/api/operator-channels/${operatorName}?catalogUrl=${encodeURIComponent(catalogUrl)}`,
      );
      const channelDetails = Array.isArray(response.data?.channels)
        ? response.data.channels
        : Array.isArray(response.data)
          ? response.data
          : [];

      const allChannels = Array.isArray(response.data?.allChannels)
        ? response.data.allChannels
        : channelDetails
            .map((channel: { name?: string }) => channel?.name)
            .filter((channel: string | undefined): channel is string => Boolean(channel));

      if (channelDetails.length > 0) {
        setAvailableVersions(prev => {
          const next = { ...prev };
          channelDetails.forEach((channel: { name?: string; availableVersions?: string[] }) => {
            if (channel?.name && Array.isArray(channel.availableVersions)) {
              next[`${operatorName}:${channel.name}:${catalogUrl}`] = channel.availableVersions;
            }
          });
          return next;
        });
      }

      setOperatorChannels(prev => ({ ...prev, [key]: allChannels }));
      return allChannels;
    } catch (error) {
      console.error(`Error fetching channels for ${operatorName}:`, error);
      addDangerAlert(`Failed to load channels for ${operatorName}`);
      return ['stable'];
    }
  };

  const fetchChannelVersions = async (
    operatorName: string,
    channelName: string,
    catalogUrl: string,
  ): Promise<string[]> => {
    try {
      const response = await axios.get(`/api/operators/${operatorName}/versions`, {
        params: { catalog: catalogUrl, channel: channelName },
      });
      if (response.data?.versions?.length > 0) return response.data.versions;
    } catch (error) {
      console.error(`Error fetching versions for ${operatorName}/${channelName}:`, error);
    }

    const versions: string[] = [];
    const match = channelName.match(/(\d+)\.(\d+)/);
    if (match) {
      const major = match[1];
      const minor = parseInt(match[2]);
      for (let p = 0; p <= 10; p++) versions.push(`${major}.${minor}.${p}`);
      for (let p = 0; p <= 5; p++) versions.push(`${major}.${minor + 1}.${p}`);
      if (minor > 0) {
        for (let p = 0; p <= 5; p++) versions.push(`${major}.${minor - 1}.${p}`);
      }
    } else {
      versions.push('1.0.0', '1.0.1', '1.0.2', '1.1.0', '1.1.1', '1.2.0', '1.2.1', '2.0.0', '2.0.1');
    }
    return versions;
  };

  const getStoredChannelVersions = (
    catalogUrl: string,
    packageName: string,
    channelName: string,
  ): string[] => {
    if (!catalogUrl || !packageName || !channelName) return [];
    return availableVersions[`${packageName}:${channelName}:${catalogUrl}`] || [];
  };

  const getChannelVersions = (
    operatorIndex: number,
    packageIndex: number,
    channelName: string,
  ): string[] => {
    const operator = config.mirror.operators[operatorIndex];
    const packageName = operator?.packages[packageIndex]?.name;
    if (!operator || !packageName || !channelName) return [];

    const key = `${packageName}:${channelName}:${operator.catalog}`;
    const versions = getStoredChannelVersions(operator.catalog, packageName, channelName);

    if (versions.length === 0) {
      fetchChannelVersions(packageName, channelName, operator.catalog)
        .then(fetched => {
          if (fetched.length > 0) {
            setAvailableVersions(prev => ({ ...prev, [key]: fetched }));
          }
        })
        .catch(err => console.error(`Error fetching versions for ${packageName}/${channelName}:`, err));
    }

    return versions;
  };

  const addPlatformChannel = () => {
    const newChannel: PlatformChannel = {
      name: `stable-${OCP_VERSIONS[0]}`,
      minVersion: '',
      maxVersion: '',
      type: 'ocp',
      shortestPath: false,
    };
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        platform: {
          ...prev.mirror.platform,
          channels: [...prev.mirror.platform.channels, newChannel],
        },
      },
    }));
  };

  const removePlatformChannel = (index: number) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        platform: {
          ...prev.mirror.platform,
          channels: prev.mirror.platform.channels.filter((_, i) => i !== index),
        },
      },
    }));
  };

  const updatePlatformChannel = (index: number, field: string, value: string | boolean) => {
    if (field === 'name' && typeof value === 'string') {
      const currentChannel = config.mirror.platform.channels[index];
      const updatedChannel = clearMismatchedPlatformVersions({
        ...currentChannel,
        name: value,
      });

      const clearedMin = Boolean(currentChannel?.minVersion && !updatedChannel.minVersion);
      const clearedMax = Boolean(currentChannel?.maxVersion && !updatedChannel.maxVersion);

      setConfig(prev => ({
        ...prev,
        mirror: {
          ...prev.mirror,
          platform: {
            ...prev.mirror.platform,
            channels: prev.mirror.platform.channels.map((ch, i) =>
              i === index ? updatedChannel : ch,
            ),
          },
        },
      }));

      if (clearedMin || clearedMax) {
        addInfoAlert('Platform Channel: Cleared versions that do not match the selected channel');
      }
      return;
    }

    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        platform: {
          ...prev.mirror.platform,
          channels: prev.mirror.platform.channels.map((ch, i) =>
            i === index ? { ...ch, [field]: value } : ch,
          ),
        },
      },
    }));
  };

  const validatePlatformChannel = (index: number, field: VersionField) => {
    const channel = config.mirror.platform.channels[index];
    if (!channel) return;

    const result = sanitizePlatformChannelValue(channel, field);
    if (result.channel !== channel) {
      setConfig(prev => ({
        ...prev,
        mirror: {
          ...prev.mirror,
          platform: {
            ...prev.mirror.platform,
            channels: prev.mirror.platform.channels.map((ch, i) =>
              i === index ? result.channel : ch,
            ),
          },
        },
      }));
    }

    const errorKey = `platform-${index}-${field}`;
    if (result.message) {
      setFieldError(errorKey, result.message);
    } else {
      clearFieldError(errorKey);
    }
  };

  const addOperator = async () => {
    const defaultCatalog =
      operatorCatalogs[0]?.url || 'registry.redhat.io/redhat/redhat-operator-index:v4.16';
    const operators = await fetchOperatorsForCatalog(defaultCatalog);

    const newOp: OperatorCatalog = {
      catalog: defaultCatalog,
      catalogVersion: defaultCatalog.split(':').pop(),
      availableOperators: operators,
      packages: [],
    };
    setConfig(prev => ({
      ...prev,
      mirror: { ...prev.mirror, operators: [...prev.mirror.operators, newOp] },
    }));
  };

  const removeOperator = (index: number) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.filter((_, i) => i !== index),
      },
    }));
  };

  const addPackageToOperator = (operatorIndex: number) => {
    const newPkg: OperatorPackage = { name: '', channels: [] };
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex ? { ...op, packages: [...op.packages, newPkg] } : op,
        ),
      },
    }));
  };

  const removePackageFromOperator = (operatorIndex: number, packageIndex: number) => {
    const operator = config.mirror.operators[operatorIndex];
    const packageToRemove = operator.packages[packageIndex];

    setConfig(prev => {
      const updatedOperators = prev.mirror.operators.map((op, i) => {
        if (i !== operatorIndex) return op;

        let updatedPackages = op.packages.filter((_, pIdx) => pIdx !== packageIndex);

        if (packageToRemove && !packageToRemove.isDependency) {
          const baseOpName = packageToRemove.name;
          updatedPackages = updatedPackages.filter(
            pkg => !pkg.isDependency || pkg.autoAddedBy !== baseOpName,
          );
        }

        return { ...op, packages: updatedPackages };
      });

      return { ...prev, mirror: { ...prev.mirror, operators: updatedOperators } };
    });
  };

  const updateOperatorPackage = async (
    operatorIndex: number,
    packageIndex: number,
    field: string,
    value: string,
  ) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex
            ? {
                ...op,
                packages: op.packages.map((pkg, pIdx) =>
                  pIdx === packageIndex ? { ...pkg, [field]: value } : pkg,
                ),
              }
            : op,
        ),
      },
    }));

    if (field === 'name' && value) {
      const operator = config.mirror.operators[operatorIndex];
      await fetchOperatorChannels(value, operator.catalog);

      try {
        const catalogVersion = operator.catalog.split(':').pop() || 'v4.19';
        const depRes = await axios.get(`/api/operators/${value}/dependencies`, {
          params: { catalogUrl: operator.catalog },
        });

        if (depRes.data?.dependencies?.length > 0) {
          const deps = depRes.data.dependencies as {
            packageName: string;
            defaultChannel?: string;
          }[];
          const vMatch = catalogVersion.match(/v?(\d+\.\d+)/);
          const defaultCh = vMatch ? `stable-${vMatch[1]}` : 'stable';

          setConfig(prev => {
            const existing = new Set(
              prev.mirror.operators[operatorIndex].packages.map(p => p.name).filter(Boolean),
            );

            const newDeps: OperatorPackage[] = deps
              .filter(d => !existing.has(d.packageName))
              .map(d => ({
                name: d.packageName,
                channels: [{ name: d.defaultChannel || defaultCh, minVersion: '', maxVersion: '' }],
                autoAddedBy: value,
                isDependency: true,
              }));

            if (newDeps.length > 0) {
              setTimeout(async () => {
                for (const dep of newDeps) {
                  await fetchOperatorChannels(dep.name, operator.catalog);
                }
              }, 0);

              addSuccessAlert(`Auto-added ${newDeps.length} dependency package(s) for ${value}`);

              return {
                ...prev,
                mirror: {
                  ...prev.mirror,
                  operators: prev.mirror.operators.map((op, i) =>
                    i === operatorIndex
                      ? { ...op, packages: [...op.packages, ...newDeps] }
                      : op,
                  ),
                },
              };
            }
            return prev;
          });
        }
      } catch {
        // Ignore dependency lookups that fail during intermediate form edits.
      }
    }
  };

  const removeOperatorPackageChannel = (
    operatorIndex: number,
    packageIndex: number,
    channelIndex: number,
  ) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex
            ? {
                ...op,
                packages: op.packages.map((pkg, pIdx) =>
                  pIdx === packageIndex
                    ? { ...pkg, channels: pkg.channels.filter((_, cIdx) => cIdx !== channelIndex) }
                    : pkg,
                ),
              }
            : op,
        ),
      },
    }));
  };

  const updateOperatorPackageChannel = async (
    operatorIndex: number,
    packageIndex: number,
    channelIndex: number,
    value: string,
  ) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex
            ? {
                ...op,
                packages: op.packages.map((pkg, pIdx) =>
                  pIdx === packageIndex
                    ? {
                        ...pkg,
                        channels: pkg.channels.map((ch, cIdx) =>
                          cIdx === channelIndex
                            ? { ...ch, name: value, minVersion: '', maxVersion: '' }
                            : ch,
                        ),
                      }
                    : pkg,
                ),
              }
            : op,
        ),
      },
    }));

    if (value) {
      const operator = config.mirror.operators[operatorIndex];
      const packageName = operator.packages[packageIndex]?.name;
      if (operator && packageName) {
        const versions = await fetchChannelVersions(packageName, value, operator.catalog);
        const key = `${packageName}:${value}:${operator.catalog}`;
        setAvailableVersions(prev => ({ ...prev, [key]: versions }));
      }
    }
  };

  const updateOperatorPackageChannelVersion = (
    operatorIndex: number,
    packageIndex: number,
    channelIndex: number,
    field: VersionField,
    value: string,
  ) => {
    const operator = config.mirror.operators[operatorIndex];
    const pkg = operator?.packages[packageIndex];
    const channel = pkg?.channels[channelIndex];
    if (!operator || !pkg || !channel) return;

    const nextChannel = { ...channel, [field]: value };
    const versions = getStoredChannelVersions(operator.catalog, pkg.name, nextChannel.name);
    const fieldErrors = getOperatorChannelFieldErrors(nextChannel, versions);

    (['minVersion', 'maxVersion'] as const).forEach(f => {
      const errorKey = `operator-${operatorIndex}-pkg-${packageIndex}-ch-${channelIndex}-${f}`;
      if (fieldErrors[f]) {
        setFieldError(errorKey, fieldErrors[f]);
      } else {
        clearFieldError(errorKey);
      }
    });

    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex
            ? {
                ...op,
                packages: op.packages.map((pkg, pIdx) =>
                  pIdx === packageIndex
                    ? {
                        ...pkg,
                        channels: pkg.channels.map((ch, cIdx) =>
                          cIdx === channelIndex ? nextChannel : ch,
                        ),
                      }
                    : pkg,
                ),
              }
            : op,
        ),
      },
    }));
  };

  const addChannelToPackage = (operatorIndex: number, packageIndex: number, channelName: string) => {
    const pkg = config.mirror.operators[operatorIndex]?.packages[packageIndex];
    if (pkg?.channels?.some(ch => ch.name === channelName)) return;

    const newCh: OperatorChannel = { name: channelName, minVersion: '', maxVersion: '' };
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        operators: prev.mirror.operators.map((op, i) =>
          i === operatorIndex
            ? {
                ...op,
                packages: op.packages.map((p, pIdx) =>
                  pIdx === packageIndex
                    ? { ...p, channels: [...(p.channels || []), newCh] }
                    : p,
                ),
              }
            : op,
        ),
      },
    }));
  };

  const addAdditionalImage = () => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        additionalImages: [...prev.mirror.additionalImages, { name: '' }],
      },
    }));
  };

  const removeAdditionalImage = (index: number) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        additionalImages: prev.mirror.additionalImages.filter((_, i) => i !== index),
      },
    }));
  };

  const updateAdditionalImage = (index: number, value: string) => {
    setConfig(prev => ({
      ...prev,
      mirror: {
        ...prev.mirror,
        additionalImages: prev.mirror.additionalImages.map((img, i) =>
          i === index ? { ...img, name: value } : img,
        ),
      },
    }));
  };

  const generateCleanConfig = useCallback((): CleanConfig => {
    const clean: CleanConfig = {
      kind: 'ImageSetConfiguration',
      apiVersion: 'mirror.openshift.io/v2alpha1',
      mirror: {},
    };

    const archiveSizeValue = config.archiveSize.trim();
    if (archiveSizeValue && !getArchiveSizeValidationMessage(archiveSizeValue)) {
      clean.archiveSize = Number.parseInt(archiveSizeValue, 10);
    }

    if (config.mirror.platform.channels?.length > 0) {
      const platformConfig: Record<string, unknown> = {
        channels: config.mirror.platform.channels.map(ch => {
          const c: CleanChannel = { name: ch.name, type: ch.type };
          if (ch.minVersion?.trim()) c.minVersion = ch.minVersion;
          if (ch.maxVersion?.trim()) c.maxVersion = ch.maxVersion;
          if (ch.shortestPath === true) c.shortestPath = true;
          return c;
        }),
      };
      if (config.mirror.platform.graph === true) {
        platformConfig.graph = true;
      }
      clean.mirror.platform = platformConfig;
    }

    if (config.mirror.operators?.length > 0) {
      clean.mirror.operators = config.mirror.operators.map(operator => {
        const catalogRef = operator.catalog;
        const resolvedCatalog = useDigestRef && catalogDigestMap[catalogRef]
          ? catalogRef.replace(/:v[\d.]+$/, `@${catalogDigestMap[catalogRef]}`)
          : catalogRef;
        return {
        catalog: resolvedCatalog,
        packages: operator.packages.map(pkg => {
          const operatorInfo = detailedOperators[operator.catalog]
            ?.find(op => op.name === pkg.name);
          const selectedChannelNames = pkg.channels.map(ch => ch.name);
          const originalDefault = operatorInfo?.defaultChannel;
          const needsDefaultOverride = originalDefault
            && !selectedChannelNames.includes(originalDefault);

          const cleanPkg: { name: string; defaultChannel?: string; channels: CleanOperatorChannel[] } = {
            name: pkg.name,
            channels: pkg.channels.map(ch => {
              const c: CleanOperatorChannel = { name: ch.name };
              if (ch.minVersion?.trim()) c.minVersion = ch.minVersion;
              if (ch.maxVersion?.trim()) c.maxVersion = ch.maxVersion;
              return c;
            }),
          };

          if (needsDefaultOverride && selectedChannelNames.length > 0) {
            cleanPkg.defaultChannel = selectedChannelNames[0];
          }

          return cleanPkg;
        }),
      };
      });
    }

    if (config.mirror.additionalImages?.length > 0) {
      clean.mirror.additionalImages = config.mirror.additionalImages;
    }

    return clean;
  }, [config, useDigestRef, catalogDigestMap, detailedOperators]);

  const validateConfiguration = (currentConfig: ImageSetConfig = config): string[] => {
    const errors: string[] = [];
    const fieldErrors: Record<string, string> = {};
    const hasPlatform = currentConfig.mirror.platform.channels.length > 0;
    const hasOps = currentConfig.mirror.operators.length > 0;
    const hasImages = currentConfig.mirror.additionalImages.length > 0;
    const archiveSizeValidationMessage = getArchiveSizeValidationMessage(
      currentConfig.archiveSize,
    );

    if (!hasPlatform && !hasOps && !hasImages) {
      errors.push('At least one platform channel, operator, or additional image is required');
      fieldErrors['config-empty'] = 'At least one platform channel, operator, or additional image is required';
    }

    if (archiveSizeValidationMessage) {
      errors.push(archiveSizeValidationMessage);
      fieldErrors['archiveSize'] = archiveSizeValidationMessage;
    }

    currentConfig.mirror.platform.channels.forEach((ch, i) => {
      if (!ch.name) {
        errors.push(`Platform channel ${i + 1} must have a name`);
        fieldErrors[`platform-${i}-name`] = 'Channel name is required';
      }
      const validationMessage = getPlatformChannelValidationMessage(ch);
      if (validationMessage) {
        errors.push(`Platform channel ${i + 1} (${ch.name || 'unnamed'}): ${validationMessage}`);
        if (validationMessage.toLowerCase().includes('min')) {
          fieldErrors[`platform-${i}-minVersion`] = validationMessage;
        } else if (validationMessage.toLowerCase().includes('max')) {
          fieldErrors[`platform-${i}-maxVersion`] = validationMessage;
        } else {
          fieldErrors[`platform-${i}-minVersion`] = validationMessage;
          fieldErrors[`platform-${i}-maxVersion`] = validationMessage;
        }
      }
    });

    currentConfig.mirror.operators.forEach((op, oIdx) => {
      if (!op.catalog) {
        errors.push(`Operator ${oIdx + 1} must have a catalog`);
        fieldErrors[`operator-${oIdx}-catalog`] = 'Catalog is required';
      }
      if (!op.packages.length) {
        errors.push(`Operator ${oIdx + 1} must have at least one package`);
        fieldErrors[`operator-${oIdx}-packages`] = 'At least one package is required';
      }
      op.packages.forEach((pkg, pIdx) => {
        if (!pkg.name) {
          errors.push(`Package ${pIdx + 1} in operator ${oIdx + 1} must have a name`);
          fieldErrors[`operator-${oIdx}-pkg-${pIdx}-name`] = 'Package name is required';
        }
        pkg.channels.forEach((ch, chIdx) => {
          if (!ch.name) {
            errors.push(
              `Channel ${chIdx + 1} in package ${pkg.name || pIdx + 1} of operator ${oIdx + 1} must have a name`,
            );
            fieldErrors[`operator-${oIdx}-pkg-${pIdx}-ch-${chIdx}-name`] = 'Channel name is required';
            return;
          }

          const channelFieldErrors = getOperatorChannelFieldErrors(
            ch,
            getStoredChannelVersions(op.catalog, pkg.name, ch.name),
          );
          const validationMessages = [channelFieldErrors.minVersion, channelFieldErrors.maxVersion]
            .filter(Boolean)
            .filter((message, index, all) => all.indexOf(message) === index);
          if (validationMessages.length) {
            errors.push(
              `Channel ${ch.name} in package ${pkg.name || pIdx + 1} of operator ${oIdx + 1}: ${validationMessages.join('; ')}`,
            );
          }
          if (channelFieldErrors.minVersion) {
            fieldErrors[`operator-${oIdx}-pkg-${pIdx}-ch-${chIdx}-minVersion`] = channelFieldErrors.minVersion;
          }
          if (channelFieldErrors.maxVersion) {
            fieldErrors[`operator-${oIdx}-pkg-${pIdx}-ch-${chIdx}-maxVersion`] = channelFieldErrors.maxVersion;
          }
        });
      });
    });

    setValidationErrors(fieldErrors);
    return errors;
  };

  const saveConfiguration = async () => {
    try {
      setLoading(true);
      const yamlString = YAML.stringify(generateCleanConfig());
      const configName = customConfigName.trim()
        ? `${customConfigName.trim()}.yaml`
        : generateDefaultConfigName();

      await axios.post('/api/config/save', { config: yamlString, name: configName });
      addSuccessAlert('Configuration saved successfully!');
      setCustomConfigName('');
      setIsEditingName(false);
    } catch (error) {
      console.error('Error saving configuration:', error);
      addDangerAlert('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  const downloadConfiguration = () => {
    const errors = validateConfiguration();
    if (errors.length > 0) {
      return;
    }

    const yamlString = YAML.stringify(generateCleanConfig());
    const blob = new Blob([yamlString], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generateDefaultConfigName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    const errors = validateConfiguration();
    if (errors.length > 0) {
      return;
    }
    await saveConfiguration();
  };

  const resetUploadState = () => {
    setUploadFilename('');
    setUploadedContent('');
    setParsedUpload(null);
    setUploadError('');
  };

  const parseYAMLContent = (content: string) => {
    try {
      const parsed = YAML.parse(content);
      if (!parsed?.kind || parsed.kind !== 'ImageSetConfiguration') {
        setUploadError('Invalid YAML: Must be an ImageSetConfiguration');
        setParsedUpload(null);
        return;
      }
      if (!parsed?.apiVersion?.includes('mirror.openshift.io')) {
        setUploadError('Invalid YAML: Must have mirror.openshift.io API version');
        setParsedUpload(null);
        return;
      }
      if (!parsed?.mirror) {
        setUploadError('Invalid YAML: Missing mirror section');
        setParsedUpload(null);
        return;
      }
      setParsedUpload(parsed);
      setUploadError('');
    } catch (err: any) {
      setUploadError(`Invalid YAML: ${err.message}`);
      setParsedUpload(null);
    }
  };

  const handleFileChange = (_: any, file: File) => {
    if (!file) return;
    if (!file.name.endsWith('.yaml') && !file.name.endsWith('.yml')) {
      setUploadError('Please upload a YAML file (.yaml or .yml)');
      return;
    }
    setUploadFilename(file.name);
    setIsUploadLoading(true);
    const reader = new FileReader();
    reader.onload = e => {
      const content = e.target?.result as string;
      setUploadedContent(content);
      parseYAMLContent(content);
      setIsUploadLoading(false);
    };
    reader.readAsText(file);
  };

  const loadIntoEditor = () => {
    if (!parsedUpload) {
      setFieldError('yaml-upload', 'No valid configuration to load');
      return;
    }
    clearFieldError('yaml-upload');

    const mirror = parsedUpload.mirror || {};

    const platformChannels: PlatformChannel[] = (mirror.platform?.channels || []).map(
      (ch: any) => ({
        name: ch.name || '',
        minVersion: ch.minVersion || '',
        maxVersion: ch.maxVersion || '',
        type: ch.type || 'ocp',
        shortestPath: ch.shortestPath || false,
      }),
    );

    const operators: OperatorCatalog[] = (mirror.operators || []).map((op: any) => ({
      catalog: op.catalog || '',
      catalogVersion: op.catalog?.split(':').pop() || '',
      availableOperators: [],
      packages: (op.packages || []).map((pkg: any) => ({
        name: pkg.name || '',
        channels: (pkg.channels || []).map((ch: any) => ({
          name: ch.name || '',
          minVersion: ch.minVersion || '',
          maxVersion: ch.maxVersion || '',
        })),
      })),
    }));

    const additionalImages: { name: string }[] = (mirror.additionalImages || []).map(
      (img: any) => ({ name: img.name || '' }),
    );

    const archiveSize =
      parsedUpload.archiveSize != null ? String(parsedUpload.archiveSize) : '';

    const nextConfig: ImageSetConfig = {
      kind: parsedUpload.kind || 'ImageSetConfiguration',
      apiVersion: parsedUpload.apiVersion || 'mirror.openshift.io/v2alpha1',
      archiveSize,
      mirror: {
        platform: {
          channels: platformChannels,
          graph: mirror.platform?.graph ?? true,
        },
        operators,
        additionalImages,
        helm: { repositories: [] },
      },
    };

    const errors = validateConfiguration(nextConfig);
    if (errors.length > 0) {
      return;
    }

    clearAllErrors();
    setConfig(nextConfig);

    setTimeout(async () => {
      for (const op of operators) {
        if (op.catalog) {
          const ops = await fetchOperatorsForCatalog(op.catalog);
          setConfig(prev => ({
            ...prev,
            mirror: {
              ...prev.mirror,
              operators: prev.mirror.operators.map(o =>
                o.catalog === op.catalog ? { ...o, availableOperators: ops } : o,
              ),
            },
          }));
          for (const pkg of op.packages) {
            if (pkg.name) {
              await fetchOperatorChannels(pkg.name, op.catalog);
            }
          }
        }
      }
    }, 0);

    setActiveTab('preview');
    addSuccessAlert('Configuration loaded. Review or edit YAML on the Preview tab.');
  };

  const yamlPreview = YAML.stringify(generateCleanConfig(), { indent: 2 });
  const startEditingPreview = () => {
    setEditedYaml(yamlPreview);
    setIsEditingPreview(true);
  };

  const cancelEditingPreview = () => {
    setIsEditingPreview(false);
    setEditedYaml('');
  };

  const applyPreviewEdits = () => {
    try {
      const parsed = YAML.parse(editedYaml);

      if (!parsed || parsed.kind !== 'ImageSetConfiguration') {
        setFieldError('yaml-preview', 'Must be an ImageSetConfiguration');
        return;
      }
      if (!parsed.apiVersion?.includes('mirror.openshift.io')) {
        setFieldError('yaml-preview', 'Must have mirror.openshift.io API version');
        return;
      }
      if (!parsed.mirror) {
        setFieldError('yaml-preview', 'Missing mirror section');
        return;
      }
      clearFieldError('yaml-preview');

      const mirror = parsed.mirror || {};
      const platformChannels: PlatformChannel[] = (mirror.platform?.channels || []).map(
        (ch: any) => ({
          name: ch.name || '',
          minVersion: ch.minVersion || '',
          maxVersion: ch.maxVersion || '',
          type: ch.type || 'ocp',
          shortestPath: ch.shortestPath || false,
        }),
      );
      const operators: OperatorCatalog[] = (mirror.operators || []).map((op: any) => ({
        catalog: op.catalog || '',
        catalogVersion: op.catalog?.split(':').pop() || '',
        availableOperators: [],
        packages: (op.packages || []).map((pkg: any) => ({
          name: pkg.name || '',
          channels: (pkg.channels || []).map((ch: any) => ({
            name: ch.name || '',
            minVersion: ch.minVersion || '',
            maxVersion: ch.maxVersion || '',
          })),
        })),
      }));
      const additionalImages: { name: string }[] = (mirror.additionalImages || []).map(
        (img: any) => ({ name: img.name || '' }),
      );
      const archiveSize = parsed.archiveSize != null ? String(parsed.archiveSize) : '';

      const nextConfig: ImageSetConfig = {
        kind: parsed.kind,
        apiVersion: parsed.apiVersion,
        archiveSize,
        mirror: {
          platform: {
            channels: platformChannels,
            graph: mirror.platform?.graph === true,
          },
          operators,
          additionalImages,
          helm: { repositories: [] },
        },
      };

      const errors = validateConfiguration(nextConfig);
      if (errors.length > 0) {
        return;
      }

      clearAllErrors();
      setConfig(nextConfig);

      setIsEditingPreview(false);
      setEditedYaml('');
      addSuccessAlert('YAML changes applied to form editor');
    } catch (err: any) {
      setFieldError('yaml-preview', `Invalid YAML: ${err.message}`);
    }
  };

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>
            <Title headingLevel="h2">
              <CogIcon /> Mirror Configuration
            </Title>
          </CardTitle>
        </CardHeader>
        <CardBody>
          Configure and manage ImageSetConfiguration files for mirror operations.
        </CardBody>
      </Card>

      <Card className="pf-v6-u-mt-lg">
        <CardBody>
          {Object.entries(validationErrors).filter(([key]) => !key.includes('-warning') && !key.startsWith('yaml-')).length > 0 && (
            <Alert variant="danger" isInline title="Configuration has errors" className="pf-v6-u-mb-md">
              <ul style={{ margin: 0 }} className="pf-v6-u-pl-md">
                {Object.entries(validationErrors).filter(([key]) => !key.includes('-warning') && !key.startsWith('yaml-')).map(([, msg], i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            </Alert>
          )}
          <Tabs
            activeKey={activeTab}
            onSelect={(_e, key) => setActiveTab(key)}
            isFilled
          >
            <Tab
              eventKey="platform"
              title={
                <>
                  <TabTitleIcon><ServerIcon /></TabTitleIcon>
                  <TabTitleText>Platform Channels</TabTitleText>
                </>
              }
            >
              <div
                className="pf-v6-u-mt-lg pf-v6-u-mb-sm"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--pf-t--global--spacer--xs)',
                }}
              >
                <Title headingLevel="h3" style={{ margin: 0 }}>
                  Platform Channels
                </Title>
                <InfoPopoverButton
                  ariaLabel="Platform channel version guidance"
                  bodyContent={
                    <div>
                      Use full OpenShift versions like `4.16.0` and `4.16.10`.
                      Leave both fields empty to mirror the entire channel.
                      Min and max must stay within the selected channel line, and
                      min cannot be greater than max.
                    </div>
                  }
                />
              </div>
              <p className="pf-v6-u-mb-md">Configure OpenShift Container Platform channels to mirror.</p>

              {config.mirror.platform.channels.length > 0 ? (
              <FieldBuilder
                firstColumnLabel="Channel Name"
                secondColumnLabel="Version Range (optional)"
                rowCount={config.mirror.platform.channels.length}
                onAddRow={() => addPlatformChannel()}
                onRemoveRow={(_e, index) => removePlatformChannel(index)}
                addButtonContent="Add platform channel"
                addButtonProps={{ style: { paddingInlineStart: 0 } }}
                rowGroupLabelPrefix="Channel"
                fieldBuilderIdPrefix="platform-channel"
                aria-label="Platform channels"
              >
                {(_helpers, index) => {
                  const channel = config.mirror.platform.channels[index];
                  return [
                    <Select
                      key="channel"
                      id={`platform-ch-name-${index}`}
                      isOpen={channelSelectOpen[index] || false}
                      selected={channel.name}
                      maxMenuHeight="20rem"
                      isScrollable
                      onSelect={(_e, val) => {
                        updatePlatformChannel(index, 'name', val as string);
                        setChannelSelectOpen(prev => ({ ...prev, [index]: false }));
                      }}
                      onOpenChange={(open) => setChannelSelectOpen(prev => ({ ...prev, [index]: open }))}
                      toggle={(toggleRef) => (
                        <MenuToggle
                          ref={toggleRef}
                          onClick={() => setChannelSelectOpen(prev => ({ ...prev, [index]: !prev[index] }))}
                          isExpanded={channelSelectOpen[index] || false}
                          style={{ width: '100%' }}
                        >
                          {channel.name || 'Select channel...'}
                        </MenuToggle>
                      )}
                    >
                      <SelectList>
                        {OCP_VERSIONS.map(v => (
                          <SelectOption key={v} value={`stable-${v}`}>
                            stable-{v}
                          </SelectOption>
                        ))}
                      </SelectList>
                    </Select>,

                    <div key="versions">
                      <Split hasGutter>
                        <SplitItem isFilled>
                          <TextInput
                            id={`platform-ch-min-${index}`}
                            value={channel.minVersion}
                            validated={validationErrors[`platform-${index}-minVersion`] ? 'error' : 'default'}
                            onChange={(_e, val) => { clearFieldError(`platform-${index}-minVersion`); updatePlatformChannel(index, 'minVersion', val); }}
                            onBlur={() => validatePlatformChannel(index, 'minVersion')}
                            placeholder="Min version"
                          />
                          {validationErrors[`platform-${index}-minVersion`] && (
                            <HelperText>
                              <HelperTextItem variant="error">{validationErrors[`platform-${index}-minVersion`]}</HelperTextItem>
                            </HelperText>
                          )}
                        </SplitItem>
                        <SplitItem isFilled>
                          <TextInput
                            id={`platform-ch-max-${index}`}
                            value={channel.maxVersion}
                            validated={validationErrors[`platform-${index}-maxVersion`] ? 'error' : 'default'}
                            onChange={(_e, val) => { clearFieldError(`platform-${index}-maxVersion`); updatePlatformChannel(index, 'maxVersion', val); }}
                            onBlur={() => validatePlatformChannel(index, 'maxVersion')}
                            placeholder="Max version"
                          />
                          {validationErrors[`platform-${index}-maxVersion`] && (
                            <HelperText>
                              <HelperTextItem variant="error">{validationErrors[`platform-${index}-maxVersion`]}</HelperTextItem>
                            </HelperText>
                          )}
                        </SplitItem>
                      </Split>
                      <Checkbox
                        id={`platform-ch-sp-${index}`}
                        label="Shortest path"
                        isChecked={channel.shortestPath || false}
                        onChange={(_e, checked) => updatePlatformChannel(index, 'shortestPath', checked)}
                        className="pf-v6-u-mt-sm"
                      />
                    </div>,
                  ];
                }}
              </FieldBuilder>
              ) : (
                <Button variant="link" icon={<PlusCircleIcon />} onClick={() => addPlatformChannel()} style={{ paddingInlineStart: 0 }}>
                  Add platform channel
                </Button>
              )}
            </Tab>

            <Tab
              eventKey="operators"
              title={
                <>
                  <TabTitleIcon><CogIcon /></TabTitleIcon>
                  <TabTitleText>Operators</TabTitleText>
                </>
              }
            >
              <Title headingLevel="h3" className="pf-v6-u-mt-lg pf-v6-u-mb-sm">Operators</Title>
              <p className="pf-v6-u-mb-md">Configure operator catalogs and packages to mirror.</p>

              {loading && <Spinner size="lg" />}

              {config.mirror.operators.map((operator, opIndex) => (
                <div
                  key={opIndex}
                  className="pf-v6-u-pb-md pf-v6-u-mb-md"
                  style={{
                    borderBottom: '1px solid var(--pf-t--global--border--color--default)',
                  }}
                >
                  <Flex alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem grow={{ default: 'grow' }}>
                      <Select
                        id={`op-catalog-${opIndex}`}
                        isOpen={catalogSelectOpen[opIndex] || false}
                        selected={operator.catalog}
                        maxMenuHeight="20rem"
                        isScrollable
                        onSelect={async (_e, val) => {
                          const newCatalog = val as string;
                          setCatalogSelectOpen(prev => ({ ...prev, [opIndex]: false }));
                          const version = newCatalog.split(':').pop();
                          const ops = await fetchOperatorsForCatalog(newCatalog);
                          setConfig(prev => ({
                            ...prev,
                            mirror: {
                              ...prev.mirror,
                              operators: prev.mirror.operators.map((op, i) =>
                                i === opIndex
                                  ? {
                                      ...op,
                                      catalog: newCatalog,
                                      catalogVersion: version,
                                      availableOperators: ops,
                                    }
                                  : op,
                              ),
                            },
                          }));
                        }}
                        onOpenChange={(open) => setCatalogSelectOpen(prev => ({ ...prev, [opIndex]: open }))}
                        toggle={(toggleRef) => (
                          <MenuToggle
                            ref={toggleRef}
                            onClick={() => setCatalogSelectOpen(prev => ({ ...prev, [opIndex]: !prev[opIndex] }))}
                            isExpanded={catalogSelectOpen[opIndex] || false}
                            isFullWidth
                          >
                            {(() => {
                              const cat = operatorCatalogs.find(c => c.url === operator.catalog);
                              if (cat) return `${cat.name} (${cat.url.split(':').pop()})`;
                              return operator.catalog || 'Select a catalog...';
                            })()}
                          </MenuToggle>
                        )}
                      >
                        {Object.entries(operatorCatalogsByVersion).map(([version, catalogs]) => (
                          <SelectGroup key={version} label={version} className="pf-v6-u-font-weight-bold">
                            <SelectList>
                              {catalogs.map(cat => (
                                <SelectOption key={cat.url} value={cat.url}>
                                  {`${cat.name} - ${cat.description}`}
                                </SelectOption>
                              ))}
                            </SelectList>
                          </SelectGroup>
                        ))}
                      </Select>
                    </FlexItem>
                    <FlexItem>
                      <Button
                        variant="plain"
                        icon={<MinusCircleIcon />}
                        onClick={() => removeOperator(opIndex)}
                        aria-label={`Remove catalog ${opIndex + 1}`}
                      />
                    </FlexItem>
                  </Flex>

                  <div className="pf-v6-u-mt-sm">
                    {operator.packages.length > 0 ? (
                    <FieldBuilder
                      firstColumnLabel="Operator"
                      rowCount={operator.packages.length}
                      onAddRow={() => addPackageToOperator(opIndex)}
                      onRemoveRow={(_e, pkgIndex) => removePackageFromOperator(opIndex, pkgIndex)}
                      addButtonContent="Add operator"
                      addButtonProps={{ style: { paddingInlineStart: 0 } }}
                      rowGroupLabelPrefix="Operator"
                      fieldBuilderIdPrefix={`catalog-${opIndex}-operator`}
                      aria-label={`Operators for catalog ${opIndex + 1}`}
                    >
                      {(_pkgHelpers, pkgIndex) => {
                        const pkg = operator.packages[pkgIndex];
                        const dOps = detailedOperators[operator.catalog];
                        const info = dOps?.find(o => o.name === pkg.name);
                        return (
                          <div>
                            {pkg.isDependency && pkg.autoAddedBy && (
                              <Badge isRead className="pf-v6-u-mb-sm">Auto-added for {pkg.autoAddedBy}</Badge>
                            )}
                            <TypeaheadSelect
                              id={`op-pkg-name-${opIndex}-${pkgIndex}`}
                              initialOptions={(operator.availableOperators || [])
                                .slice()
                                .sort((a, b) => a.localeCompare(b))
                                .map((name): TypeaheadSelectOption => ({
                                  value: name,
                                  content: name,
                                  selected: name === pkg.name,
                                }))}
                              onSelect={(_e, value) => {
                                if (value) {
                                  updateOperatorPackage(opIndex, pkgIndex, 'name', String(value));
                                }
                              }}
                              placeholder="Type to search operators..."
                              noOptionsFoundMessage={(filter) => `No operators found for "${filter}"`}
                              maxMenuHeight="20rem"
                              isScrollable
                              toggleProps={{ isFullWidth: true, className: 'hide-typeahead-clear' }}
                            />

                            {pkg.name && info && (
                              <div className="pf-v6-u-mt-sm">
                                <DescriptionList isCompact isHorizontal>
                                  <DescriptionListGroup>
                                    <DescriptionListTerm>Default Channel</DescriptionListTerm>
                                    <DescriptionListDescription>
                                      <Label color="green">{info.defaultChannel}</Label>
                                    </DescriptionListDescription>
                                  </DescriptionListGroup>
                                  <DescriptionListGroup>
                                    <DescriptionListTerm>Available Channels ({info.allChannels?.length || 0})</DescriptionListTerm>
                                    <DescriptionListDescription>
                                      <Flex gap={{ default: 'gapSm' }}>
                                    {info.allChannels?.map((ch, idx) => {
                                      const isDefault = ch === info.defaultChannel;
                                      const isSelected = pkg.channels?.some(c => c.name === ch);
                                      return (
                                        <FlexItem key={idx}>
                                          <Label
                                            color={isDefault ? 'green' : 'grey'}
                                            onClick={() => {
                                              if (!isSelected) {
                                                addChannelToPackage(opIndex, pkgIndex, ch);
                                              }
                                            }}
                                            style={{
                                              cursor: isSelected ? 'default' : 'pointer',
                                              opacity: isSelected ? 0.5 : 1,
                                            }}
                                          >
                                            {ch}
                                          </Label>
                                        </FlexItem>
                                      );
                                    })}
                                      </Flex>
                                    </DescriptionListDescription>
                                  </DescriptionListGroup>
                                </DescriptionList>

                                {pkg.channels && pkg.channels.length > 0 && (
                                  <div className="pf-v6-u-mt-sm">
                                    <FieldBuilder
                                      firstColumnLabel="Channel"
                                      secondColumnLabel={
                                        <Grid hasGutter style={{ paddingInlineEnd: 'var(--pf-t--global--spacer--xs)' }}>
                                          <GridItem span={6}>Min Version</GridItem>
                                          <GridItem span={6}>Max Version</GridItem>
                                        </Grid>
                                      }
                                      rowCount={pkg.channels.length}
                                      onAddRow={() => addChannelToPackage(opIndex, pkgIndex, '')}
                                      onRemoveRow={(_e, chIdx) => removeOperatorPackageChannel(opIndex, pkgIndex, chIdx)}
                                      addButtonContent="Add channel"
                                      addButtonProps={{ size: 'sm', style: { paddingInlineStart: 0 } }}
                                      rowGroupLabelPrefix="Channel"
                                      fieldBuilderIdPrefix={`catalog-${opIndex}-op-${pkgIndex}-ch`}
                                      aria-label={`Channels for ${pkg.name}`}
                                    >
                                      {(_chHelpers, chIdx) => {
                                        const channel = pkg.channels[chIdx];
                                        const versions = getChannelVersions(opIndex, pkgIndex, channel.name);
                                        const minVersionOptions = getSelectableVersions(versions, 'minVersion', channel.maxVersion);
                                        const maxVersionOptions = getSelectableVersions(versions, 'maxVersion', channel.minVersion);

                                        return [
                                          <Select
                                            key="channel"
                                            id={`ch-sel-${opIndex}-${pkgIndex}-${chIdx}`}
                                            isOpen={opChannelSelectOpen[`${opIndex}-${pkgIndex}-${chIdx}`] || false}
                                            selected={channel.name}
                                            maxMenuHeight="20rem"
                                            isScrollable
                                            onSelect={(_e, val) => {
                                              setOpChannelSelectOpen(prev => ({ ...prev, [`${opIndex}-${pkgIndex}-${chIdx}`]: false }));
                                              updateOperatorPackageChannel(opIndex, pkgIndex, chIdx, val as string);
                                            }}
                                            onOpenChange={(open) => setOpChannelSelectOpen(prev => ({ ...prev, [`${opIndex}-${pkgIndex}-${chIdx}`]: open }))}
                                            toggle={(toggleRef) => (
                                              <MenuToggle
                                                ref={toggleRef}
                                                onClick={() => setOpChannelSelectOpen(prev => ({ ...prev, [`${opIndex}-${pkgIndex}-${chIdx}`]: !prev[`${opIndex}-${pkgIndex}-${chIdx}`] }))}
                                                isExpanded={opChannelSelectOpen[`${opIndex}-${pkgIndex}-${chIdx}`] || false}
                                                isFullWidth
                                              >
                                                {channel.name
                                                  ? (channel.name === info?.defaultChannel ? `${channel.name} (default)` : channel.name)
                                                  : 'Select a channel...'}
                                              </MenuToggle>
                                            )}
                                          >
                                            <SelectList>
                                              <SelectOption value="">Select a channel...</SelectOption>
                                              {info?.allChannels?.map(ch => (
                                                <SelectOption key={ch} value={ch}>
                                                  {ch === info.defaultChannel ? `${ch} (default)` : ch}
                                                </SelectOption>
                                              ))}
                                            </SelectList>
                                          </Select>,

                                          <Grid key="versionrange" hasGutter>
                                            {(['minVersion', 'maxVersion'] as const).map(field => {
                                              const options = field === 'minVersion' ? minVersionOptions : maxVersionOptions;
                                              const errorKey = `operator-${opIndex}-pkg-${pkgIndex}-ch-${chIdx}-${field}`;
                                              return (
                                                <GridItem key={field} span={6}>
                                                  <TypeaheadSelect
                                                    id={`ch-${field}-${opIndex}-${pkgIndex}-${chIdx}`}
                                                    initialOptions={options.map((version): TypeaheadSelectOption => ({
                                                      value: version,
                                                      content: version,
                                                      selected: version === channel[field],
                                                    }))}
                                                    onSelect={(_e, value) => {
                                                      clearFieldError(errorKey);
                                                      updateOperatorPackageChannelVersion(opIndex, pkgIndex, chIdx, field, String(value));
                                                    }}
                                                    placeholder="Type to search versions..."
                                                    noOptionsFoundMessage={(filter) => `No versions found for "${filter}"`}
                                                    maxMenuHeight="20rem"
                                                    isScrollable
                                                    toggleProps={{ isFullWidth: true, className: 'hide-typeahead-clear', 'aria-label': field === 'minVersion' ? 'Min Version' : 'Max Version' }}
                                                  />
                                                  {validationErrors[errorKey] && (
                                                    <HelperText>
                                                      <HelperTextItem variant="error">{validationErrors[errorKey]}</HelperTextItem>
                                                    </HelperText>
                                                  )}
                                                </GridItem>
                                              );
                                            })}
                                          </Grid>,
                                        ];
                                      }}
                                    </FieldBuilder>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }}
                    </FieldBuilder>
                    ) : (
                      <Button variant="link" icon={<PlusCircleIcon />} onClick={() => addPackageToOperator(opIndex)} style={{ paddingInlineStart: 0 }}>
                        Add operator
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              <Button variant="link" icon={<PlusCircleIcon />} onClick={() => addOperator()} style={{ paddingInlineStart: 0 }}>
                Add operator catalog
              </Button>
            </Tab>

            <Tab
              eventKey="images"
              title={
                <>
                  <TabTitleIcon><CubesIcon /></TabTitleIcon>
                  <TabTitleText>Additional Images</TabTitleText>
                </>
              }
            >
              <Title headingLevel="h3" className="pf-v6-u-mt-lg pf-v6-u-mb-sm">Additional Images</Title>
              <p className="pf-v6-u-mb-md">Add additional container images to mirror.</p>

              {config.mirror.additionalImages.length > 0 ? (
              <FieldBuilder
                firstColumnLabel="Image Name"
                rowCount={config.mirror.additionalImages.length}
                onAddRow={() => addAdditionalImage()}
                onRemoveRow={(_e, index) => removeAdditionalImage(index)}
                addButtonContent="Add image"
                addButtonProps={{ style: { paddingInlineStart: 0 } }}
                rowGroupLabelPrefix="Image"
                fieldBuilderIdPrefix="additional-image"
                aria-label="Additional images"
              >
                {(_helpers, index) => {
                  const image = config.mirror.additionalImages[index];
                  return (
                    <div>
                      <TextInput
                        id={`img-name-${index}`}
                        value={image.name}
                        onChange={(_e, val) => { clearFieldError(`img-${index}-warning`); updateAdditionalImage(index, val); }}
                        onBlur={() => {
                          const warning = getImageNameWarning(image.name);
                          if (warning) setFieldError(`img-${index}-warning`, warning);
                          else clearFieldError(`img-${index}-warning`);
                        }}
                        placeholder="registry.redhat.io/example/image:tag"
                      />
                      {validationErrors[`img-${index}-warning`] && (
                        <Alert variant="warning" isInline title={validationErrors[`img-${index}-warning`]} className="pf-v6-u-mt-sm" />
                      )}
                    </div>
                  );
                }}
              </FieldBuilder>
              ) : (
                <Button variant="link" icon={<PlusCircleIcon />} onClick={() => addAdditionalImage()} style={{ paddingInlineStart: 0 }}>
                  Add image
                </Button>
              )}
            </Tab>

            <Tab
              eventKey="preview"
              title={
                <>
                  <TabTitleIcon><EyeIcon /></TabTitleIcon>
                  <TabTitleText>Preview</TabTitleText>
                </>
              }
            >
              <Split hasGutter className="pf-v6-u-mt-lg">
                <SplitItem isFilled>
                  <Title headingLevel="h3" className="pf-v6-u-mb-sm">ImageSetConfiguration Preview</Title>
                  <p>Preview and edit the generated ImageSetConfiguration YAML.</p>
                </SplitItem>
                <SplitItem>
                  <Split hasGutter>
                    <SplitItem>
                      <Button
                        variant="secondary"
                        icon={<CopyIcon />}
                        onClick={() => {
                          navigator.clipboard.writeText(isEditingPreview ? editedYaml : yamlPreview);
                          addSuccessAlert('YAML configuration copied to clipboard!');
                        }}
                      >
                        Copy YAML
                      </Button>
                    </SplitItem>
                    {!isEditingPreview && (
                      <SplitItem>
                        <Button variant="secondary" onClick={startEditingPreview}>
                          Edit
                        </Button>
                      </SplitItem>
                    )}
                  </Split>
                </SplitItem>
              </Split>

              <Card
                isPlain
                isCompact
                className="pf-v6-u-mt-md pf-v6-u-mb-lg"
                style={{ overflow: 'visible' }}
              >
                <CardBody style={{ padding: 0 }}>
                  <Grid hasGutter>
                    <GridItem span={4}>
                      <FormGroup
                        label={
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 'var(--pf-t--global--spacer--xs)',
                            }}
                          >
                            <span>Archive Size</span>
                            <InfoPopoverButton
                              ariaLabel="Archive size guidance"
                              bodyContent={
                                <div>
                                  Maximum size in GiB for each archive when mirroring to disk.
                                  Leave empty or 0 to use the default behavior.
                                </div>
                              }
                            />
                          </span>
                        }
                        fieldId="archive-size"
                      >
                        <NumberInput
                          id="archive-size"
                          value={config.archiveSize ? Number(config.archiveSize) : 0}
                          min={0}
                          onMinus={() =>
                            setConfig(prev => {
                              const current = prev.archiveSize ? Number(prev.archiveSize) : 0;
                              return { ...prev, archiveSize: String(Math.max(0, current - 1)) };
                            })
                          }
                          onPlus={() =>
                            setConfig(prev => {
                              const current = prev.archiveSize ? Number(prev.archiveSize) : 0;
                              return { ...prev, archiveSize: String(current + 1) };
                            })
                          }
                          onChange={(e: React.FormEvent<HTMLInputElement>) => {
                            const val = (e.target as HTMLInputElement).value;
                            setConfig(prev => ({
                              ...prev,
                              archiveSize: sanitizeArchiveSizeInput(val),
                            }));
                          }}
                          widthChars={4}
                          unit="GiB"
                          minusBtnAriaLabel="Decrease archive size"
                          plusBtnAriaLabel="Increase archive size"
                        />
                      </FormGroup>
                    </GridItem>
                    <GridItem span={4}>
                      <FormGroup label="Catalog References" fieldId="use-digest-ref-toggle">
                        {hasAnyDigest ? (
                          <Switch
                            id="use-digest-ref-toggle"
                            label="Use digest references"
                            isChecked={useDigestRef}
                            onChange={(_e, checked) => setUseDigestRef(checked)}
                            aria-label="Toggle digest references"
                          />
                        ) : (
                          <Tooltip content="Run Sync Catalogs in Settings to fetch digests">
                            <Switch
                              id="use-digest-ref-toggle"
                              label="Use digest references"
                              isChecked={false}
                              isDisabled
                              aria-label="Toggle digest references"
                            />
                          </Tooltip>
                        )}
                      </FormGroup>
                    </GridItem>
                  </Grid>
                </CardBody>
              </Card>

              {isEditingPreview ? (
                <>
                  <YamlHighlighter
                    code={editedYaml}
                    id="yaml-preview-editor"
                    editable
                    onChange={setEditedYaml}
                  />
                  {validationErrors['yaml-preview'] && (
                    <Alert variant="danger" isInline title={validationErrors['yaml-preview']} className="pf-v6-u-mt-sm" />
                  )}
                  <Split hasGutter className="pf-v6-u-mt-sm">
                    <SplitItem>
                      <Button variant="primary" onClick={() => { clearFieldError('yaml-preview'); applyPreviewEdits(); }}>
                        Apply Changes
                      </Button>
                    </SplitItem>
                    <SplitItem>
                      <Button variant="link" onClick={cancelEditingPreview}>
                        Cancel
                      </Button>
                    </SplitItem>
                  </Split>
                </>
              ) : (
                <YamlHighlighter code={yamlPreview} id="yaml-preview" />
              )}
            </Tab>

            <Tab
              eventKey="upload"
              title={
                <>
                  <TabTitleIcon><UploadIcon /></TabTitleIcon>
                  <TabTitleText>Load Configuration</TabTitleText>
                </>
              }
            >
              <Title headingLevel="h3" className="pf-v6-u-mt-lg pf-v6-u-mb-sm">Load ImageSetConfiguration YAML</Title>
              <p>
                Upload an existing ImageSetConfiguration YAML file, review and edit it, then
                save it or load it into the form editor for further modification.
              </p>

              <div className="pf-v6-u-mt-md">
                <FileUpload
                  id="yaml-file-upload"
                  type="text"
                  value={uploadedContent}
                  filename={uploadFilename}
                  filenamePlaceholder="Drag and drop a .yaml file or click to browse"
                  onFileInputChange={handleFileChange}
                  onClearClick={() => resetUploadState()}
                  isLoading={isUploadLoading}
                  browseButtonText="Browse"
                  clearButtonText="Clear"
                  hideDefaultPreview
                  dropzoneProps={{
                    accept: { 'text/yaml': ['.yaml', '.yml'] },
                  }}
                />
              </div>

              {uploadError && (
                <Alert
                  variant={AlertVariant.danger}
                  isInline
                  title={uploadError}
                  className="pf-v6-u-mt-md"
                />
              )}

              {parsedUpload && (
                <Alert
                  variant={AlertVariant.success}
                  isInline
                  title="Valid ImageSetConfiguration detected"
                  className="pf-v6-u-mt-md"
                >
                  <DescriptionList isHorizontal isCompact>
                    <DescriptionListGroup>
                      <DescriptionListTerm>Kind</DescriptionListTerm>
                      <DescriptionListDescription>{parsedUpload.kind}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>API Version</DescriptionListTerm>
                      <DescriptionListDescription>{parsedUpload.apiVersion}</DescriptionListDescription>
                    </DescriptionListGroup>
                    {parsedUpload.mirror?.platform?.channels && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>Platform Channels</DescriptionListTerm>
                        <DescriptionListDescription>{parsedUpload.mirror.platform.channels.length}</DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                    {parsedUpload.mirror?.operators && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>Operators</DescriptionListTerm>
                        <DescriptionListDescription>{parsedUpload.mirror.operators.length}</DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                    {parsedUpload.mirror?.additionalImages && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>Additional Images</DescriptionListTerm>
                        <DescriptionListDescription>{parsedUpload.mirror.additionalImages.length}</DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                  </DescriptionList>
                </Alert>
              )}

              {digestValidationResults.length > 0 && (
                <div className="pf-v6-u-mt-md">
                  {digestValidationResults.map((result, i) => (
                    <Alert
                      key={i}
                      variant={result.status === 'match' ? 'success' : result.status === 'mismatch' ? 'warning' : 'info'}
                      isInline
                      isPlain
                      title={
                        result.status === 'match'
                          ? `${result.name} ${result.ocp} \u2014 digest matches current catalog`
                          : result.status === 'mismatch'
                            ? `${result.name} \u2014 digest does not match any synced version (checked: ${result.ocp}; config: ${result.configDigest?.slice(0, 19)}...)`
                            : `${result.name} \u2014 no digest available, run Sync Catalogs to verify`
                      }
                      className="pf-v6-u-mt-xs"
                    />
                  ))}
                </div>
              )}

              {uploadedContent && (
                <div className="pf-v6-u-mt-md">
                  <YamlHighlighter code={uploadedContent} id="yaml-upload-preview" />
                </div>
              )}

              {validationErrors['yaml-upload'] && (
                <Alert variant="danger" isInline title={validationErrors['yaml-upload']} className="pf-v6-u-mt-sm" />
              )}
              <div className="pf-v6-u-mt-md">
                <Button
                  variant="primary"
                  icon={<ArrowRightIcon />}
                  onClick={() => { clearFieldError('yaml-upload'); loadIntoEditor(); }}
                  isDisabled={!parsedUpload}
                >
                  Load into Editor
                </Button>
              </div>
            </Tab>
          </Tabs>

          <div className="pf-v6-u-pt-md pf-v6-u-mt-md" style={{ borderTop: '1px solid var(--pf-t--global--border--color--default)' }}>
            <Flex direction={{ default: 'column' }} gap={{ default: 'gapMd' }}>
              <FlexItem>
                {isEditingName ? (
                  <Split hasGutter>
                    <SplitItem isFilled>
                      <TextInput
                        id="inline-edit-config-name"
                        value={editingNameValue}
                        onChange={(_e, val) => setEditingNameValue(val)}
                        placeholder="Enter name (without .yaml extension)"
                        aria-label="Configuration filename"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setCustomConfigName(editingNameValue.trim());
                            setIsEditingName(false);
                          } else if (e.key === 'Escape') {
                            setIsEditingName(false);
                          }
                        }}
                        autoFocus
                      />
                    </SplitItem>
                    <SplitItem>
                      <Button
                        variant="plain"
                        icon={<CheckIcon />}
                        aria-label="Confirm filename"
                        onClick={() => {
                          setCustomConfigName(editingNameValue.trim());
                          setIsEditingName(false);
                        }}
                      />
                    </SplitItem>
                    <SplitItem>
                      <Button
                        variant="plain"
                        icon={<TimesIcon />}
                        aria-label="Cancel editing filename"
                        onClick={() => setIsEditingName(false)}
                      />
                    </SplitItem>
                  </Split>
                ) : (
                  <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                    <FlexItem>
                      <div style={{ fontSize: '0.875rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                        {customConfigName.trim()
                          ? `${customConfigName.trim()}.yaml`
                          : generateDefaultConfigName()}
                      </div>
                    </FlexItem>
                    <FlexItem>
                      <Tooltip content="Edit filename">
                        <Button
                          variant="plain"
                          icon={<PencilAltIcon />}
                          aria-label="Edit filename"
                          onClick={() => {
                            setEditingNameValue(customConfigName);
                            setIsEditingName(true);
                          }}
                        />
                      </Tooltip>
                    </FlexItem>
                  </Flex>
                )}
              </FlexItem>

              <FlexItem>
                <Split hasGutter>
                  <SplitItem>
                    <Button
                      variant="primary"
                      icon={<SaveIcon />}
                      onClick={handleSave}
                      isDisabled={loading}
                      isLoading={loading}
                    >
                      Save Configuration
                    </Button>
                  </SplitItem>
                  <SplitItem>
                    <Button
                      variant="secondary"
                      icon={<DownloadIcon />}
                      onClick={downloadConfiguration}
                    >
                      Download YAML
                    </Button>
                  </SplitItem>
                </Split>
              </FlexItem>
            </Flex>
          </div>
        </CardBody>
      </Card>

    </div>
  );
};

export default MirrorConfig;
