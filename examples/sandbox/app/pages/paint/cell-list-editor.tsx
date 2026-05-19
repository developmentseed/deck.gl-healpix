import { useRef } from 'react';
import { Box, Field, Textarea } from '@chakra-ui/react';

import { PAINT_COLORS, type PaintColorIndex } from './colors';
import type { CellLine } from './colored-cells';
import {
  emptyEditorLine,
  linesFromText,
  linesToText,
  trimTrailingBlankLines
} from './colored-cells';

const LINE_HEIGHT = '1.4375rem';
const EDITOR_FONT = 'mono';
const EDITOR_SIZE = 'sm';

type CellListEditorProps = {
  lines: CellLine[];
  selectedColorIndex: PaintColorIndex;
  onChange: (lines: CellLine[]) => void;
};

export function CellListEditor({
  lines,
  selectedColorIndex,
  onChange
}: CellListEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const editorLines =
    lines.length > 0 ? lines : [emptyEditorLine(selectedColorIndex)];
  const text = linesToText(editorLines);
  const lineCount = Math.max(editorLines.length, 1);

  const syncScroll = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const commit = (nextText: string) => {
    onChange(linesFromText(nextText, editorLines, selectedColorIndex));
  };

  return (
    <Field.Root w='100%'>
      <Field.Label fontSize='xs' textTransform='uppercase'>
        Cell IDs
      </Field.Label>
      <Box
        w='100%'
        borderWidth='1px'
        borderRadius='md'
        maxH='14rem'
        overflow='hidden'
        display='flex'
        bg='bg'
      >
        <Box
          ref={gutterRef}
          flexShrink={0}
          overflow='hidden'
          pt='2'
          pb='2'
          pl='2'
          pr='1'
          bg='bg.muted'
          borderRightWidth='1px'
          aria-hidden
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <Box
              key={i}
              h={LINE_HEIGHT}
              display='flex'
              alignItems='center'
              justifyContent='center'
              w='4'
            >
              <Box
                w='3'
                h='3'
                borderRadius='sm'
                bg={
                  PAINT_COLORS[editorLines[i]?.colorIndex ?? selectedColorIndex]
                }
              />
            </Box>
          ))}
        </Box>
        <Textarea
          ref={textareaRef}
          flex='1'
          variant='flushed'
          size={EDITOR_SIZE}
          fontFamily={EDITOR_FONT}
          lineHeight={LINE_HEIGHT}
          rows={6}
          resize='none'
          borderWidth={0}
          px={2}
          py='2'
          spellCheck={false}
          value={text}
          placeholder='Type a cell ID and press Enter…'
          onScroll={syncScroll}
          onBlur={() => {
            const trimmed = trimTrailingBlankLines(
              linesFromText(text, editorLines, selectedColorIndex)
            );
            onChange(trimmed);
          }}
          onChange={(e) => commit(e.target.value)}
        />
      </Box>
    </Field.Root>
  );
}
