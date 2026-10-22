import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import {
  Page,
  Masthead,
  MastheadMain,
  MastheadBrand,
  MastheadContent,
  MastheadToggle,
  PageSidebar,
  PageSidebarBody,
  PageSection,
  PageToggleButton,
  Nav,
  NavList,
  NavItem,
  Brand,
  Spinner,
  Title,
  Content,
  Label,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  TachometerAltIcon,
  CogIcon,
  SyncAltIcon,
  HistoryIcon,
  WrenchIcon,
} from '@patternfly/react-icons';
import { AlertProvider } from './AlertContext';
import { ThemeProvider, useTheme } from './ThemeContext';
import { MirrorConfigProvider } from './MirrorConfigContext';
import ThemeToggle from './components/ThemeToggle';
import redhatLogo from '/Logo-Red.svg';
import redhatLogoDark from '/Logo-Red-Reverse.svg';

const Dashboard = lazy(() => import('./components/Dashboard'));
const MirrorConfig = lazy(() => import('./components/MirrorConfig'));
const MirrorOperations = lazy(() => import('./components/MirrorOperations'));
const History = lazy(() => import('./components/History'));
const Settings = lazy(() => import('./components/Settings'));

interface NavRoute {
  path: string;
  label: string;
  icon: React.ReactNode;
  component: React.LazyExoticComponent<React.ComponentType>;
}

const navRoutes: NavRoute[] = [
  { path: '/', label: 'Dashboard', icon: <TachometerAltIcon />, component: Dashboard },
  { path: '/config', label: 'Mirror Configuration', icon: <CogIcon />, component: MirrorConfig },
  { path: '/operations', label: 'Mirror Operations', icon: <SyncAltIcon />, component: MirrorOperations },
  { path: '/history', label: 'History', icon: <HistoryIcon />, component: History },
  { path: '/settings', label: 'Settings', icon: <WrenchIcon />, component: Settings },
];

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { effectiveTheme } = useTheme();

  const sidebar = (
    <PageSidebar>
      <PageSidebarBody>
        <Nav>
          <NavList>
            {navRoutes.map((item) => (
              <NavItem
                key={item.path}
                itemId={item.path}
                isActive={location.pathname === item.path}
                onClick={() => navigate(item.path)}
                icon={item.icon}
                style={{ fontSize: '1rem' }}
              >
                {item.label}
              </NavItem>
            ))}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadToggle>
          <PageToggleButton aria-label="Navigation toggle" isHamburgerButton />
        </MastheadToggle>
        <MastheadBrand>
          <Brand src={effectiveTheme === 'dark' ? redhatLogoDark : redhatLogo} alt="Red Hat" heights={{ default: '36px' }} />
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar style={{ width: '100%' }}>
          <ToolbarContent>
            <ToolbarItem>
              <div>
                <Title headingLevel="h1" size="2xl" style={{ lineHeight: 1.2, fontSize: '2rem' }}>OpenShift Mirror Console</Title>
                <Content component="p" style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: '1.25rem', lineHeight: 1.2 }}>
                  Image Mirroring for Disconnected Clusters
                </Content>
              </div>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <div style={{ display: 'flex', alignItems: 'stretch', gap: 'var(--pf-t--global--spacer--sm)' }}>
                <ThemeToggle />
                <Label
                  color="blue"
                  style={{
                    fontSize: '0.875rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: 'var(--pf-t--global--border--radius--pill)',
                  }}
                >
                  v1.0
                </Label>
              </div>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  return (
    <Page masthead={masthead} sidebar={sidebar} isManagedSidebar>
      <PageSection style={{ minHeight: 'calc(100vh - 76px)' }}>
        <Suspense
          fallback={
            <div className="pf-v6-u-text-align-center pf-v6-u-p-2xl">
              <Spinner aria-label="Loading page" />
            </div>
          }
        >
          <Routes>
            {navRoutes.map((item) => (
              <Route key={item.path} path={item.path} element={<item.component />} />
            ))}
          </Routes>
        </Suspense>
      </PageSection>
    </Page>
  );
};

const App: React.FC = () => (
  <ThemeProvider>
    <AlertProvider>
      <MirrorConfigProvider>
        <BrowserRouter>
          <AppLayout />
        </BrowserRouter>
      </MirrorConfigProvider>
    </AlertProvider>
  </ThemeProvider>
);

export default App;
