import {
  Button,
  ChakraProvider,
  Heading,
  Image,
  Flex,
  Separator,
  Link,
  IconButton
} from '@chakra-ui/react';
import { CollecticonBrandGithub } from '@devseed-ui/collecticons-chakra';
import { BrowserRouter, NavLink, NavLinkProps } from 'react-router';
import system from '../styles/theme';

export function PageNavLink(props: NavLinkProps) {
  return (
    <Button
      variant='ghost'
      colorPalette='orange'
      size='sm'
      css={{
        '&.active': {
          bg: 'colorPalette.100'
        }
      }}
      asChild
    >
      <NavLink {...props} />
    </Button>
  );
}

// Root component.
export function PageLayout(props: {
  children?: React.ReactNode;
  title?: string;
  navSlot?: React.ReactNode;
}) {
  const { children, title = import.meta.env.VITE_APP_TITLE, navSlot } = props;

  return (
    <ChakraProvider value={system}>
      <BrowserRouter>
        <Flex w='100vw' h='100vh' flexFlow='column'>
          <Flex
            alignItems='center'
            justifyContent='space-between'
            w='100%'
            boxShadow='md'
            p={4}
          >
            <Heading display='flex' gap={2} alignItems='center'>
              <Image src='/logo.svg' alt='Logo' boxSize='32px' />
              {title}
            </Heading>
            <Flex alignItems='center' gap={2}>
              {navSlot}
              <Separator orientation='vertical' h={4} />
              <IconButton variant='ghost' size='sm' asChild>
                <Link target='_blank' rel='noopener noreferrer' href='https://github.com/developmentseed/deck.gl-healpix'>
                  <CollecticonBrandGithub />
                </Link>
              </IconButton>
            </Flex>
          </Flex>

          {children}
        </Flex>
      </BrowserRouter>
    </ChakraProvider>
  );
}
