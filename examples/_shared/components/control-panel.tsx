import { useState } from 'react';
import { Flex, Heading, IconButton, Text } from '@chakra-ui/react';
import { FaSliders, FaXmark } from 'react-icons/fa6';

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
          <FaSliders />
        </IconButton>
      )}

      {isOpen && (
        <Flex
          position='absolute'
          top={4}
          left={4}
          zIndex={1000}
          bg='white'
          borderRadius='lg'
          boxShadow='lg'
          borderWidth='1px'
          borderColor='border.muted'
          p={4}
          w={{ base: 'calc(100vw - 2rem)', md: '22rem' }}
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
            <FaXmark />
          </IconButton>
          {(title || description) && (
            <Flex flexFlow='column' gap={1} pr={{ base: 8, md: 0 }}>
              {title && (
                <Heading fontSize='md' fontWeight='semibold'>
                  {title}
                </Heading>
              )}

              {description && (
                <Text fontSize='xs' color='fg.muted' lineHeight='short'>
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
