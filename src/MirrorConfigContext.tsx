import React, { createContext, useContext, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ImageSetConfig, DetailedOperator } from './components/MirrorConfig';

/**
 * Holds the Mirror Configuration draft above the router so it survives
 * navigating between pages. The draft lives in memory only: a browser
 * refresh starts from an empty configuration.
 */

type StateSetter<T> = Dispatch<SetStateAction<T>>;

interface MirrorConfigContextType {
  config: ImageSetConfig;
  setConfig: StateSetter<ImageSetConfig>;
  customConfigName: string;
  setCustomConfigName: StateSetter<string>;
  useDigestRef: boolean;
  setUseDigestRef: StateSetter<boolean>;
  // Catalog lookups backing the operator dropdowns of the current draft.
  detailedOperators: Record<string, DetailedOperator[]>;
  setDetailedOperators: StateSetter<Record<string, DetailedOperator[]>>;
  operatorChannels: Record<string, string[]>;
  setOperatorChannels: StateSetter<Record<string, string[]>>;
  availableVersions: Record<string, string[]>;
  setAvailableVersions: StateSetter<Record<string, string[]>>;
  // Bumped whenever the draft is replaced, so in-flight lookups for the old draft can be dropped.
  draftGeneration: MutableRefObject<number>;
  // Saved config filename that another page asked Mirror Configuration to open.
  pendingConfigFile: string | null;
  setPendingConfigFile: StateSetter<string | null>;
}

/** Create a fresh empty draft with the default mirroring settings. */
export const createEmptyConfig = (): ImageSetConfig => ({
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

const MirrorConfigContext = createContext<MirrorConfigContextType | null>(null);

/** Access the shared draft; throws when used outside its provider. */
export const useMirrorConfig = (): MirrorConfigContextType => {
  const context = useContext(MirrorConfigContext);
  if (!context) {
    throw new Error('useMirrorConfig must be used within a MirrorConfigProvider');
  }
  return context;
};

/** Keep the draft and its editor metadata in memory across route changes. */
export const MirrorConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<ImageSetConfig>(createEmptyConfig);
  const [customConfigName, setCustomConfigName] = useState('');
  const [useDigestRef, setUseDigestRef] = useState(false);
  const [detailedOperators, setDetailedOperators] = useState<Record<string, DetailedOperator[]>>({});
  const [operatorChannels, setOperatorChannels] = useState<Record<string, string[]>>({});
  const [availableVersions, setAvailableVersions] = useState<Record<string, string[]>>({});
  const [pendingConfigFile, setPendingConfigFile] = useState<string | null>(null);
  const draftGeneration = useRef(0);

  return (
    <MirrorConfigContext.Provider
      value={{
        config,
        setConfig,
        customConfigName,
        setCustomConfigName,
        useDigestRef,
        setUseDigestRef,
        detailedOperators,
        setDetailedOperators,
        operatorChannels,
        setOperatorChannels,
        availableVersions,
        setAvailableVersions,
        draftGeneration,
        pendingConfigFile,
        setPendingConfigFile,
      }}
    >
      {children}
    </MirrorConfigContext.Provider>
  );
};
