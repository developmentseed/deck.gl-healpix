import {
  Button,
  Field,
  Flex,
  HStack,
  IconButton,
  NativeSelect,
  Separator,
  Stack,
  Text
} from '@chakra-ui/react';
import { FaEraser, FaExpand, FaPaintbrush, FaTrashCan } from 'react-icons/fa6';

import { ControlPanel } from '$shared/components/control-panel';

import { CellListEditor } from './cell-list-editor';
import { ColorSwatches } from './color-swatches';
import { NSIDE_OPTIONS } from './constants';
import type { CellLine } from './colored-cells';
import { countFilledLines } from './colored-cells';
import type { PaintColorIndex } from './colors';
import { PanelSwitch } from './panel-switch';
import type { HealpixScheme, MapTool } from './types';

type PaintControlsProps = {
  nside: number;
  scheme: HealpixScheme;
  lines: CellLine[];
  selectedColorIndex: PaintColorIndex;
  activeTool: MapTool | null;
  isCoarsePointer: boolean;
  showBbox: boolean;
  showCellIds: boolean;
  canFitBounds: boolean;
  onNsideChange: (nside: number) => void;
  onSchemeChange: (scheme: HealpixScheme) => void;
  onLinesChange: (lines: CellLine[]) => void;
  onColorIndexChange: (index: PaintColorIndex) => void;
  onToolChange: (tool: MapTool | null) => void;
  onClearCells: () => void;
  onFitBounds: () => void;
  onShowBboxChange: (show: boolean) => void;
  onShowCellIdsChange: (show: boolean) => void;
};

function ToolHint({
  activeTool,
  isCoarsePointer
}: {
  activeTool: MapTool;
  isCoarsePointer: boolean;
}) {
  if (isCoarsePointer) {
    return (
      <Text fontSize='xs' color='fg.muted' lineHeight='short'>
        One finger to {activeTool === 'paint' ? 'paint' : 'erase'} · two fingers
        to pan.
      </Text>
    );
  }

  return (
    <Text fontSize='xs' color='fg.muted' lineHeight='short'>
      Hold{' '}
      <Text
        as='kbd'
        px={1}
        py={0.5}
        borderRadius='sm'
        borderWidth='1px'
        borderColor='border.muted'
        bg='bg.muted'
        fontSize='xs'
        fontFamily='mono'
      >
        Space
      </Text>{' '}
      to pan the map.
    </Text>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      fontSize='sm'
      fontWeight='semibold'
      textTransform='uppercase'
      letterSpacing='wider'
      color='fg.muted'
    >
      {children}
    </Text>
  );
}

export function PaintControls(props: PaintControlsProps) {
  const {
    nside,
    scheme,
    lines,
    selectedColorIndex,
    activeTool,
    isCoarsePointer,
    showBbox,
    showCellIds,
    canFitBounds,
    onNsideChange,
    onSchemeChange,
    onLinesChange,
    onColorIndexChange,
    onToolChange,
    onClearCells,
    onFitBounds,
    onShowBboxChange,
    onShowCellIdsChange
  } = props;

  const filledCount = countFilledLines(lines);

  const toggleTool = (tool: MapTool) => {
    onToolChange(activeTool === tool ? null : tool);
  };

  return (
    <ControlPanel
      title='HEALPix painter'
      description='Paint cells on the map or edit IDs below.'
    >
      <Flex direction='column' gap={4} w='100%'>
        <Flex direction='column' gap={2} w='100%'>
          <SectionLabel>Grid</SectionLabel>
          <HStack gap={2} w='100%' align='flex-end'>
            <Field.Root flex='1' minW={0} gap={0}>
              <Field.Label fontSize='xs' mb={1} textTransform='uppercase'>
                Nside
              </Field.Label>
              <NativeSelect.Root size='sm'>
                <NativeSelect.Field
                  value={String(nside)}
                  onChange={(e) => onNsideChange(Number(e.target.value))}
                >
                  {NSIDE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>

            <Field.Root flex='1' minW={0} gap={0} textTransform='uppercase'>
              <Field.Label fontSize='xs' mb={1}>
                Scheme
              </Field.Label>
              <NativeSelect.Root size='sm'>
                <NativeSelect.Field
                  value={scheme}
                  onChange={(e) =>
                    onSchemeChange(e.target.value as HealpixScheme)
                  }
                >
                  <option value='nest'>NEST</option>
                  <option value='ring'>RING</option>
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>
          </HStack>
        </Flex>

        <Stack gap={1}>
          <CellListEditor
            lines={lines}
            selectedColorIndex={selectedColorIndex}
            onChange={onLinesChange}
          />

          <Flex align='center' justify='space-between' w='100%' gap={2}>
            <Text fontSize='sm' color='fg.muted'>
              <Text as='span' fontWeight='semibold' color='fg'>
                {filledCount}
              </Text>{' '}
              cell{filledCount === 1 ? '' : 's'}
            </Text>
            <Button
              size='xs'
              textTransform='uppercase'
              variant='ghost'
              colorPalette='red'
              onClick={onClearCells}
              disabled={filledCount === 0}
            >
              <FaTrashCan />
              Clear
            </Button>
          </Flex>
        </Stack>

        <Flex direction='column' gap={2} w='100%'>
          <SectionLabel>Display</SectionLabel>
          <HStack gap={2} w='100%' align='stretch'>
            <PanelSwitch
              label='Cell IDs'
              checked={showCellIds}
              onCheckedChange={onShowCellIdsChange}
            />
            <PanelSwitch
              label='BBox'
              checked={showBbox}
              onCheckedChange={onShowBboxChange}
            />
            <IconButton
              aria-label='Fit bounds to cells'
              title='Fit bounds'
              size='sm'
              variant='outline'
              flexShrink={0}
              alignSelf='stretch'
              onClick={onFitBounds}
              disabled={!canFitBounds}
            >
              <FaExpand />
            </IconButton>
          </HStack>
        </Flex>

        <Separator />

        <Flex direction='column' gap={3} w='100%'>
          <SectionLabel>Paint</SectionLabel>
          <Flex
            align='center'
            justify='space-between'
            gap={3}
            w='100%'
            flexWrap='wrap'
          >
            <HStack
              gap={0}
              p={0.5}
              bg='bg.muted'
              borderRadius='md'
              borderWidth='1px'
              borderColor='border.muted'
            >
              <IconButton
                aria-label='Paint cells'
                title='Paint'
                size='sm'
                variant={activeTool === 'paint' ? 'solid' : 'ghost'}
                colorPalette={activeTool === 'paint' ? 'teal' : 'gray'}
                borderRadius='md'
                onClick={() => toggleTool('paint')}
              >
                <FaPaintbrush />
              </IconButton>
              <IconButton
                aria-label='Erase cells'
                title='Erase'
                size='sm'
                variant={activeTool === 'erase' ? 'solid' : 'ghost'}
                colorPalette={activeTool === 'erase' ? 'red' : 'gray'}
                borderRadius='md'
                onClick={() => toggleTool('erase')}
              >
                <FaEraser />
              </IconButton>
            </HStack>

            <ColorSwatches
              selectedIndex={selectedColorIndex}
              onSelect={onColorIndexChange}
            />
          </Flex>
          {activeTool !== null && (
            <ToolHint
              activeTool={activeTool}
              isCoarsePointer={isCoarsePointer}
            />
          )}
        </Flex>
      </Flex>
    </ControlPanel>
  );
}
