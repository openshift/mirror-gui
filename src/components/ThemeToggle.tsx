import React, { useState } from 'react';
import {
  Dropdown,
  DropdownItem,
  DropdownList,
  MenuToggle,
  MenuToggleElement,
} from '@patternfly/react-core';
import { OutlinedSunIcon, OutlinedMoonIcon, AdjustIcon } from '@patternfly/react-icons';
import { useTheme, ThemePreference } from '../ThemeContext';

const themeOptions: { key: ThemePreference; label: string; description: string; icon: React.ReactNode }[] = [
  { key: 'auto', label: 'System', description: 'Follow system preference', icon: <AdjustIcon /> },
  { key: 'light', label: 'Light', description: 'Always use light mode', icon: <OutlinedSunIcon /> },
  { key: 'dark', label: 'Dark', description: 'Always use dark mode', icon: <OutlinedMoonIcon /> },
];

const ThemeToggle: React.FC = () => {
  const { themePreference, effectiveTheme, setThemePreference } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const onSelect = (_event: React.MouseEvent | undefined, value: string | number | undefined) => {
    setThemePreference(value as ThemePreference);
    setIsOpen(false);
  };

  const toggleIconMap: Record<ThemePreference, React.ReactNode> = {
    auto: <AdjustIcon />,
    light: <OutlinedSunIcon />,
    dark: <OutlinedMoonIcon />,
  };
  const toggleIcon = toggleIconMap[themePreference];

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      onClick={() => setIsOpen((prev) => !prev)}
      isExpanded={isOpen}
      icon={toggleIcon}
      aria-label={`Theme selection, current: ${effectiveTheme}`}
    />
  );

  return (
    <Dropdown
      isOpen={isOpen}
      onSelect={onSelect}
      onOpenChange={setIsOpen}
      toggle={toggle}
      shouldFocusToggleOnSelect
      popperProps={{ position: 'right' }}
    >
      <DropdownList>
        {themeOptions.map((option) => (
          <DropdownItem
            key={option.key}
            value={option.key}
            icon={option.icon}
            isSelected={themePreference === option.key}
            description={option.description}
          >
            {option.label}
          </DropdownItem>
        ))}
      </DropdownList>
    </Dropdown>
  );
};

export default ThemeToggle;
