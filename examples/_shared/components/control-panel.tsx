import { useState } from 'react';
import { Flex, Heading, IconButton, Text } from '@chakra-ui/react';
import {
  CollecticonSlidersHorizontal,
  CollecticonXmarkSmall
} from '@devseed-ui/collecticons-chakra';

export function ControlPanel({
  children,
  title,
  description
}: {
  children: React.ReactNode;
  title?: string;
  description?: string;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <>
      {!isOpen && (
        <IconButton
          position='absolute'
          top={4}
          left={4}
          zIndex={1001}
          size='sm'
          bg='white'
          boxShadow='md'
          borderRadius='md'
          variant='ghost'
          onClick={() => setIsOpen(true)}
          aria-label='Show controls'
        >
          <CollecticonSlidersHorizontal />
        </IconButton>
      )}

      {isOpen && (
        <Flex
          position='absolute'
          top={4}
          left={4}
          zIndex={1000}
          bg='white'
          borderRadius='md'
          boxShadow='md'
          p={4}
          w={{ base: 'calc(100vw - 2rem)', md: '30rem' }}
          maxH='90vh'
          overflowY='auto'
          flexFlow='column'
          gap={4}
        >
          <IconButton
            display={{ base: 'flex', md: 'none' }}
            variant='ghost'
            size='sm'
            colorPalette='gray'
            onClick={() => setIsOpen(false)}
            aria-label='Hide controls'
            position='absolute'
            top={2}
            right={2}
            zIndex={1001}
          >
            <CollecticonXmarkSmall />
          </IconButton>
          {(title || description) && (
            <Flex flexFlow='column' gap={2} pr={8}>
              {title && <Heading fontSize='md'>{title}</Heading>}

              {description && (
                <Text as='span' fontSize='sm' fontStyle='italic'>
                  {description}
                </Text>
              )}
            </Flex>
          )}
          {children}
        </Flex>
      )}
    </>
  );
}
