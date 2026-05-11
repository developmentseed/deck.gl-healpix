import { useState } from 'react';
import {
  Button,
  ChakraProvider,
  Drawer,
  Heading,
  Image,
  Flex,
  Separator,
  Link,
  IconButton,
  LinkProps
} from '@chakra-ui/react';
import {
  CollecticonBrandGithub,
  CollecticonHamburgerMenu,
  CollecticonXmarkSmall
} from '@devseed-ui/collecticons-chakra';
import { BrowserRouter, NavLink } from 'react-router';
import system from '../styles/theme';

import logo from './logo.svg';

// If using a router add the public url to the base path.
const publicUrl = import.meta.env.VITE_BASE_URL || '';

const baseName = new URL(
  publicUrl.startsWith('http')
    ? publicUrl
    : `https://ds.io/${publicUrl.replace(/^\//, '')}`
).pathname;

export function PageNavLink(props: LinkProps & { to: string }) {
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
      <Link as={NavLink} _hover={{ textDecoration: 'none' }} {...props} />
    </Button>
  );
}

export type NavItem = { label: string; to: string };

// Root component.
export function PageLayout(props: {
  children?: React.ReactNode;
  title?: string;
  navItems?: NavItem[];
}) {
  const { children, title = import.meta.env.VITE_APP_TITLE, navItems } = props;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <ChakraProvider value={system}>
      <BrowserRouter basename={baseName}>
        <Drawer.Root open={menuOpen} onOpenChange={(e) => setMenuOpen(e.open)}>
          <Flex w='100vw' h='100vh' flexFlow='column'>
            <Flex
              alignItems='center'
              justifyContent='space-between'
              w='100%'
              boxShadow='md'
              p={4}
              flexShrink={0}
              zIndex={100}
              bg='white'
            >
              <Heading display='flex' gap={2} alignItems='center'>
                <Image src={logo} alt='Logo' boxSize='32px' />
                {title}
              </Heading>
              <Flex alignItems='center' gap={2}>
                {navItems && (
                  <Flex
                    display={{ base: 'none', md: 'flex' }}
                    gap={2}
                    alignItems='center'
                  >
                    {navItems.map((item) => (
                      <PageNavLink key={item.to} to={item.to}>
                        {item.label}
                      </PageNavLink>
                    ))}
                    <Separator orientation='vertical' h={4} />
                  </Flex>
                )}
                <IconButton variant='ghost' size='sm' asChild>
                  <Link
                    target='_blank'
                    rel='noopener noreferrer'
                    href='https://github.com/developmentseed/deck.gl-healpix'
                  >
                    <CollecticonBrandGithub />
                  </Link>
                </IconButton>
                {navItems && (
                  <IconButton
                    display={{ base: 'flex', md: 'none' }}
                    variant='ghost'
                    size='sm'
                    aria-label='Open menu'
                    onClick={() => setMenuOpen(true)}
                  >
                    <CollecticonHamburgerMenu />
                  </IconButton>
                )}
              </Flex>
            </Flex>

            {children}
          </Flex>

          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content>
              <Drawer.CloseTrigger asChild>
                <IconButton variant='ghost' size='sm'>
                  <CollecticonXmarkSmall />
                </IconButton>
              </Drawer.CloseTrigger>
              <Drawer.Header p={4}>
                <Drawer.Title>Menu</Drawer.Title>
              </Drawer.Header>
              <Drawer.Body display='flex' flexFlow='column' gap={1} p={2}>
                {navItems?.map((item) => (
                  <PageNavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    justifyContent='flex-start'
                    px={4}
                  >
                    {item.label}
                  </PageNavLink>
                ))}
              </Drawer.Body>
            </Drawer.Content>
          </Drawer.Positioner>
        </Drawer.Root>
      </BrowserRouter>
    </ChakraProvider>
  );
}
