import { Box, Flex } from '@chakra-ui/react';

import { PAINT_COLORS, type PaintColorIndex } from './colors';

type ColorSwatchesProps = {
  selectedIndex: PaintColorIndex;
  onSelect: (index: PaintColorIndex) => void;
};

export function ColorSwatches({ selectedIndex, onSelect }: ColorSwatchesProps) {
  return (
    <Flex gap={2} role='radiogroup' aria-label='Paint color'>
      {PAINT_COLORS.map((hex, index) => {
        const selected = index === selectedIndex;
        return (
          <Box
            key={hex}
            as='button'
            role='radio'
            aria-checked={selected}
            aria-label={`Color ${index + 1}`}
            w='8'
            h='8'
            borderRadius='md'
            bg={hex}
            borderWidth='2px'
            borderStyle='solid'
            borderColor={selected ? 'gray.800' : 'transparent'}
            boxShadow={selected ? '0 0 0 2px white, 0 0 0 4px gray.800' : 'sm'}
            cursor='pointer'
            onClick={() => onSelect(index as PaintColorIndex)}
          />
        );
      })}
    </Flex>
  );
}
