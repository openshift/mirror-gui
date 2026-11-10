import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageSection,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarGroup,
  Select,
  SelectOption,
  SelectList,
  MenuToggle,
  Label,
  Button,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  CodeBlock,
  CodeBlockCode,
  Alert,
  Spinner,
  Title,
  EmptyState,
  EmptyStateBody,
  Timestamp,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalVariant,
  Tooltip,
} from '@patternfly/react-core';
import {
  HistoryIcon,
  SearchIcon,
  DownloadIcon,
  AngleRightIcon,
  AngleDownIcon,
  AngleUpIcon,
  OutlinedClockIcon,
  ListIcon,
  TrashAltIcon,
  PencilAltIcon,
} from '@patternfly/react-icons';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { useAlerts } from '../AlertContext';
import { useMirrorConfig } from '../MirrorConfigContext';

interface Operation {
  id: string;
  name: string;
  configFile: string;
  status: 'running' | 'success' | 'failed' | 'stopped';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  errorMessage?: string;
}

interface OperationDetails {
  imagesMirrored?: number;
  operatorsMirrored?: number;
  totalSize?: number;
  platformImages?: number;
  additionalImages?: number;
  helmCharts?: number;
  configFile?: string;
  status?: string;
}

const History: React.FC = () => {
  const { addSuccessAlert, addDangerAlert } = useAlerts();
  const navigate = useNavigate();
  const { setPendingConfigFile } = useMirrorConfig();

  const openConfigInEditor = (configFile: string) => {
    setPendingConfigFile(configFile);
    navigate('/config');
  };

  const [operations, setOperations] = useState<Operation[]>([]);
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null);
  const [operationDetails, setOperationDetails] = useState<OperationDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [filterSelectOpen, setFilterSelectOpen] = useState(false);
  const [liveLog, setLiveLog] = useState('');
  const [logSource, setLogSource] = useState<EventSource | null>(null);
  const operationRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const logRef = useRef<HTMLDivElement>(null);

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [deleteModalTarget, setDeleteModalTarget] = useState<'selected' | 'all' | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/operations/history');
      setOperations(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching history:', error);
      addDangerAlert('Failed to load operation history');
    } finally {
      setLoading(false);
    }
  }, [addDangerAlert]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!selectedOperation) return;
    setLiveLog('');
    if (logSource) {
      logSource.close();
      setLogSource(null);
    }

    axios.get(`/api/operations/${selectedOperation.id}/logs`).then(res => {
      setLiveLog(res.data.logs || '');
    }).catch(err => {
      console.error('Error fetching logs:', err);
      setLiveLog('No logs available for this operation.');
    });

    if (selectedOperation.status === 'running') {
      try {
        const es = new EventSource(`/api/operations/${selectedOperation.id}/logstream`);
        es.onmessage = (e) => {
          setLiveLog((prev) => `${prev}${e.data ? `${e.data}\n` : ''}`);
        };
        es.onerror = () => {
          es.close();
        };
        setLogSource(es);
        return () => {
          es.close();
        };
      } catch (error) {
        console.error('Error setting up SSE connection:', error);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOperation]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [liveLog]);

  const scrollToSelectedOperation = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!selectedOperation) {
      return;
    }

    const selectedRow = operationRowRefs.current[selectedOperation.id];
    if (!selectedRow) {
      return;
    }

    const main = document.querySelector('main.pf-v6-c-page__main');
    if (main instanceof HTMLElement) {
      const mainRect = main.getBoundingClientRect();
      const rowRect = selectedRow.getBoundingClientRect();
      const targetTop = rowRect.top - mainRect.top + main.scrollTop - 16;

      main.scrollTo({
        top: Math.max(targetTop, 0),
        behavior,
      });

      return;
    }

    selectedRow.scrollIntoView({
      behavior,
      block: 'start',
    });
  }, [selectedOperation]);

  useEffect(() => {
    if (!selectedOperation) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToSelectedOperation('smooth');
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedOperation, scrollToSelectedOperation]);

  const fetchOperationDetails = async (operationId: string) => {
    try {
      const response = await axios.get(`/api/operations/${operationId}/details`);
      setOperationDetails(response.data);
    } catch (error) {
      console.error('Error fetching operation details:', error);
      const operation = operations.find(op => op.id === operationId);
      if (operation) {
        setOperationDetails({
          imagesMirrored: 0,
          operatorsMirrored: 0,
          totalSize: 0,
          platformImages: 0,
          additionalImages: 0,
          helmCharts: 0,
          configFile: operation.configFile,
          status: operation.status,
        });
      }
    }
  };

  const clearSelectedOperation = () => {
    if (logSource) {
      logSource.close();
      setLogSource(null);
    }

    setSelectedOperation(null);
    setOperationDetails(null);
    setLiveLog('');
  };

  const filteredOperations = operations.filter(op => {
    if (op.status === 'running') return false;
    if (filter === 'all') return true;
    return op.status === filter;
  });

  const toggleChecked = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredChecked = filteredOperations.length > 0 && filteredOperations.every(op => checkedIds.has(op.id));
  const someFilteredChecked = filteredOperations.some(op => checkedIds.has(op.id));

  const toggleSelectAll = () => {
    if (allFilteredChecked) {
      setCheckedIds(prev => {
        const next = new Set(prev);
        for (const op of filteredOperations) next.delete(op.id);
        return next;
      });
    } else {
      setCheckedIds(prev => {
        const next = new Set(prev);
        for (const op of filteredOperations) next.add(op.id);
        return next;
      });
    }
  };

  const deleteOperations = async (ids: string[]) => {
    setDeleting(true);
    try {
      await Promise.all(ids.map(id => axios.delete(`/api/operations/${id}`)));
      if (selectedOperation && ids.includes(selectedOperation.id)) {
        clearSelectedOperation();
      }
      setCheckedIds(prev => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      addSuccessAlert(`Deleted ${ids.length} operation${ids.length > 1 ? 's' : ''}`);
      await fetchHistory();
    } catch {
      addDangerAlert('Failed to delete some operations');
    } finally {
      setDeleting(false);
      setDeleteModalTarget(null);
    }
  };

  const confirmDelete = () => {
    if (deleteModalTarget === 'selected') {
      const ids = filteredOperations.filter(op => checkedIds.has(op.id)).map(op => op.id);
      void deleteOperations(ids);
    } else if (deleteModalTarget === 'all') {
      void deleteOperations(filteredOperations.map(op => op.id));
    }
  };

  const deleteModalCount = deleteModalTarget === 'all'
    ? filteredOperations.length
    : filteredOperations.filter(op => checkedIds.has(op.id)).length;

  const handleOperationSelect = (operation: Operation) => {
    setOperationDetails(null);
    setSelectedOperation(operation);
    fetchOperationDetails(operation.id);
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'success':
        return <Label status="success">Success</Label>;
      case 'failed':
        return <Label status="danger">Failed</Label>;
      case 'stopped':
        return <Label status="warning">Stopped</Label>;
      default:
        return <Label color="grey">Unknown</Label>;
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  const renderOperationDetails = () => {
    if (!selectedOperation) {
      return null;
    }

    const configName = selectedOperation.configFile;

    return (
      <Card isPlain isCompact className="pf-v6-u-mt-sm" style={{ minWidth: 0 }}>
        <CardBody>
          <Title headingLevel="h4" className="pf-v6-u-mb-md">
            <SearchIcon className="pf-v6-u-mr-sm" /> Operation Details
          </Title>

          <DescriptionList isCompact>
            <DescriptionListGroup>
              <DescriptionListTerm>Name</DescriptionListTerm>
              <DescriptionListDescription>{selectedOperation.name}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Status</DescriptionListTerm>
              <DescriptionListDescription>{getStatusLabel(selectedOperation.status)}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Started</DescriptionListTerm>
              <DescriptionListDescription>
                <Timestamp date={new Date(selectedOperation.startedAt)} tooltip={{ variant: 'default' }} />
              </DescriptionListDescription>
            </DescriptionListGroup>
            {selectedOperation.completedAt && (
              <DescriptionListGroup>
                <DescriptionListTerm>
                  {selectedOperation.status === 'failed' ? 'Failed At' : selectedOperation.status === 'stopped' ? 'Stopped At' : 'Completed'}
                </DescriptionListTerm>
                <DescriptionListDescription>
                  <Timestamp date={new Date(selectedOperation.completedAt)} tooltip={{ variant: 'default' }} />
                </DescriptionListDescription>
              </DescriptionListGroup>
            )}
            <DescriptionListGroup>
              <DescriptionListTerm>Duration</DescriptionListTerm>
              <DescriptionListDescription>{formatDuration(selectedOperation.duration)}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Config File</DescriptionListTerm>
              <DescriptionListDescription>
                <Button
                  variant="link"
                  isInline
                  component="a"
                  href={`/api/config/download/${encodeURIComponent(configName)}`}
                  download={configName}
                >
                  {configName}
                </Button>{' '}
                <Button
                  variant="link"
                  isInline
                  icon={<PencilAltIcon />}
                  onClick={() => openConfigInEditor(configName)}
                >
                  Edit in Mirror Configuration
                </Button>
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>

          {selectedOperation.errorMessage && selectedOperation.status !== 'stopped' && (
            <Alert
              variant="danger"
              isInline
              title="Error"
              className="pf-v6-u-mt-md"
            >
              {selectedOperation.errorMessage}
            </Alert>
          )}

          {operationDetails && (
            <div className="pf-v6-u-mt-md">
              <Title headingLevel="h4" className="pf-v6-u-mb-sm">
                Operation Statistics
              </Title>
              <DescriptionList isCompact>
                <DescriptionListGroup>
                  <DescriptionListTerm>Images Mirrored</DescriptionListTerm>
                  <DescriptionListDescription>{operationDetails.imagesMirrored || 0}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Operators Mirrored</DescriptionListTerm>
                  <DescriptionListDescription>{operationDetails.operatorsMirrored || 0}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Total Size</DescriptionListTerm>
                  <DescriptionListDescription>{formatFileSize(operationDetails.totalSize)}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Platform Images</DescriptionListTerm>
                  <DescriptionListDescription>{operationDetails.platformImages || 0}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Additional Images</DescriptionListTerm>
                  <DescriptionListDescription>{operationDetails.additionalImages || 0}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Helm Charts</DescriptionListTerm>
                  <DescriptionListDescription>{operationDetails.helmCharts || 0}</DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </div>
          )}

          <div className="pf-v6-u-mt-lg">
            <Title headingLevel="h4" className="pf-v6-u-mb-sm">
              <ListIcon className="pf-v6-u-mr-sm" /> Log Output
            </Title>
            <div ref={logRef} style={{ maxHeight: '320px', overflow: 'auto' }}>
              <CodeBlock>
                <CodeBlockCode>{liveLog || 'No log output available...'}</CodeBlockCode>
              </CodeBlock>
            </div>
          </div>

          <div className="pf-v6-u-mt-md" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              icon={<AngleUpIcon />}
              onClick={() => scrollToSelectedOperation('smooth')}
            >
              Back to top
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  };

  const exportHistory = () => {
    const csvContent = [
      ['Operation Name', 'Status', 'Started', 'Duration', 'Config File', 'Error Message'],
      ...filteredOperations.map(op => [
        op.name,
        op.status,
        new Date(op.startedAt).toLocaleString(),
        formatDuration(op.duration),
        op.configFile,
        op.errorMessage || '',
      ]),
    ].map(row => row.map(field => `"${field}"`).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mirror-history-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <PageSection>
        <EmptyState>
          <Spinner size="xl" />
          <EmptyStateBody>Loading history...</EmptyStateBody>
        </EmptyState>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Card>
        <CardHeader>
          <CardTitle>
            <Title headingLevel="h2">
              <HistoryIcon className="pf-v6-u-mr-sm" />
              Operation History
            </Title>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p>View detailed history of all mirror operations.</p>
        </CardBody>
      </Card>

      <Card className="pf-v6-u-mt-lg" style={{ minWidth: 0 }}>
        <CardHeader>
          <CardTitle>
            <Title headingLevel="h3">
              <ListIcon className="pf-v6-u-mr-sm" />
              Operations
            </Title>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <Toolbar>
            <ToolbarContent>
              <ToolbarItem>
                <Select
                  isOpen={filterSelectOpen}
                  selected={filter}
                  onSelect={(_e, val) => {
                    setFilter(val as string);
                    setFilterSelectOpen(false);
                  }}
                  onOpenChange={(open) => setFilterSelectOpen(open)}
                  toggle={(toggleRef) => (
                    <MenuToggle
                      ref={toggleRef}
                      onClick={() => setFilterSelectOpen(prev => !prev)}
                      isExpanded={filterSelectOpen}
                      aria-label="Filter operations"
                    >
                      {{ all: 'All Operations', success: 'Successful', failed: 'Failed', stopped: 'Stopped' }[filter] || 'All Operations'}
                    </MenuToggle>
                  )}
                >
                  <SelectList>
                    <SelectOption value="all">All Operations</SelectOption>
                    <SelectOption value="success">Successful</SelectOption>
                    <SelectOption value="failed">Failed</SelectOption>
                    <SelectOption value="stopped">Stopped</SelectOption>
                  </SelectList>
                </Select>
              </ToolbarItem>
              <ToolbarItem>
                <Button variant="secondary" icon={<DownloadIcon />} onClick={exportHistory}>
                  Export CSV
                </Button>
              </ToolbarItem>
              <ToolbarGroup align={{ default: 'alignEnd' }}>
                {someFilteredChecked && (
                  <ToolbarItem>
                    <Button
                      variant="secondary"
                      icon={<TrashAltIcon />}
                      isDanger
                      onClick={() => setDeleteModalTarget('selected')}
                    >
                      Delete Selected ({filteredOperations.filter(op => checkedIds.has(op.id)).length})
                    </Button>
                  </ToolbarItem>
                )}
                {filteredOperations.length > 0 && (
                  <ToolbarItem>
                    <Button
                      variant="secondary"
                      icon={<TrashAltIcon />}
                      isDanger
                      onClick={() => setDeleteModalTarget('all')}
                    >
                      Delete All
                    </Button>
                  </ToolbarItem>
                )}
              </ToolbarGroup>
            </ToolbarContent>
          </Toolbar>
        </CardBody>
        <CardBody className="pf-v6-u-p-0">
          {filteredOperations.length === 0 ? (
            <EmptyState>
              <SearchIcon />
              <EmptyStateBody>No operations found.</EmptyStateBody>
            </EmptyState>
          ) : (
            <Table aria-label="Operations list" variant="compact" borders={false}>
              <Thead>
                <Tr>
                  <Th
                    select={{
                      onSelect: toggleSelectAll,
                      isSelected: allFilteredChecked,
                    }}
                    aria-label="Select all"
                  />
                  <Th>Operation</Th>
                  <Th>Config</Th>
                  <Th>Status</Th>
                  <Th>Started</Th>
                  <Th>Duration</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filteredOperations.map((op, rowIndex) => {
                  const isSelected = selectedOperation?.id === op.id;

                  return (
                    <Fragment key={op.id}>
                      <Tr
                        isClickable
                        onRowClick={() => (
                          isSelected
                            ? clearSelectedOperation()
                            : handleOperationSelect(op)
                        )}
                      >
                        <Td
                          select={{
                            rowIndex,
                            onSelect: () => {
                              toggleChecked(op.id);
                            },
                            isSelected: checkedIds.has(op.id),
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Td dataLabel="Operation">
                          <div
                            ref={(element) => {
                              operationRowRefs.current[op.id] = element;
                            }}
                            style={{
                              scrollMarginTop: '1rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 'var(--pf-t--global--spacer--xs)',
                            }}
                          >
                            <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                              {isSelected ? <AngleDownIcon /> : <AngleRightIcon />}
                            </span>
                            {op.name}
                          </div>
                        </Td>
                        <Td dataLabel="Config">
                          <Button
                            variant="link"
                            isInline
                            component="a"
                            href={`/api/config/download/${encodeURIComponent(op.configFile)}`}
                            download={op.configFile}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {op.configFile}
                          </Button>
                          <Tooltip content="Edit in Mirror Configuration">
                            <Button
                              variant="plain"
                              size="sm"
                              icon={<PencilAltIcon />}
                              aria-label={`Edit ${op.configFile} in Mirror Configuration`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openConfigInEditor(op.configFile);
                              }}
                            />
                          </Tooltip>
                        </Td>
                        <Td dataLabel="Status">
                          {getStatusLabel(op.status)}
                        </Td>
                        <Td dataLabel="Started">
                          <Timestamp date={new Date(op.startedAt)} tooltip={{ variant: 'default' }} />
                        </Td>
                        <Td dataLabel="Duration">
                          <OutlinedClockIcon /> {formatDuration(op.duration)}
                        </Td>
                      </Tr>
                      {isSelected && (
                        <Tr>
                          <Td colSpan={6}>
                            {renderOperationDetails()}
                          </Td>
                        </Tr>
                      )}
                    </Fragment>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>
      <Modal
        variant={ModalVariant.small}
        isOpen={deleteModalTarget !== null}
        onClose={() => setDeleteModalTarget(null)}
        aria-label="Confirm deletion"
      >
        <ModalHeader title="Delete Operations" />
        <ModalBody>
          <p>
            Are you sure you want to delete{' '}
            <strong>
              {deleteModalTarget === 'all' ? 'all' : deleteModalCount}
            </strong>{' '}
            operation{deleteModalCount !== 1 ? 's' : ''}? This action cannot be undone.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="danger"
            onClick={confirmDelete}
            isDisabled={deleting}
            isLoading={deleting}
          >
            Delete
          </Button>
          <Button variant="link" onClick={() => setDeleteModalTarget(null)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </PageSection>
  );
};

export default History;
