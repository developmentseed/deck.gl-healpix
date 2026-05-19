import { Flex, Switch, Text } from '@chakra-ui/react';

type PanelSwitchProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export function PanelSwitch({
  label,
  checked,
  onCheckedChange
}: PanelSwitchProps) {
  return (
    <Flex
      align='center'
      justify='space-between'
      gap={2}
      flex='1'
      minW='0'
      px={2}
      py={1.5}
      borderRadius='md'
      borderWidth='1px'
      borderColor='border.muted'
      bg='bg.muted'
    >
      <Text fontSize='sm' fontWeight='medium' truncate>
        {label}
      </Text>
      <Switch.Root
        size='sm'
        checked={checked}
        onCheckedChange={(e) => onCheckedChange(!!e.checked)}
      >
        <Switch.HiddenInput />
        <Switch.Control />
      </Switch.Root>
    </Flex>
  );
}
