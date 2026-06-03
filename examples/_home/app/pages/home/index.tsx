import { useRef } from 'react';
import Map, { type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Box,
  Button,
  Flex,
  Heading,
  Image,
  Link,
  List,
  Stack,
  Text
} from '@chakra-ui/react';

import { DeckGlOverlay } from '$shared/components/deckgl-overlay';
import { useHealpixTrail } from './use-healpix-trail';

import logo from '$shared/components/logo.svg';
import exampleSandboxImg from '../../images/example-sandbox.png';
import exampleZarrImg from '../../images/example-zarr.png';
import { FaGithub } from 'react-icons/fa6';

const EXAMPLES = [
  {
    title: 'Sandbox',
    description: 'Experiment with different HEALPix layers and datasets.',
    href: '/examples/sandbox',
    image: exampleSandboxImg
  },
  {
    title: 'Zarr Explorer',
    description: 'Visualize HEALPix datasets stored in Zarr format.',
    href: '/examples/zarr-tiles',
    image: exampleZarrImg
  }
];

export default function PageHome() {
  const mapRef = useRef<MapRef>(null);
  const { layers } = useHealpixTrail(mapRef);

  return (
    <Flex
      w='100%'
      minH='100vh'
      direction='column'
      position='relative'
      overflow='hidden'
      fontFamily='Montserrat'
    >
      <Box inset={0} position='fixed' overscrollBehavior='none' opacity={0.5}>
        <Map
          mapStyle={`https://api.maptiler.com/maps/dataviz-v4-light/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`}
          style={{ width: '100%', height: '100%' }}
          ref={mapRef}
          interactive={false}
        >
          <DeckGlOverlay layers={layers} />
        </Map>
      </Box>
      <Stack position='relative' zIndex={10}>
        <Stack align='center' mt={16} gap={4}>
          <Heading
            as='h1'
            display='flex'
            gap={8}
            alignItems='center'
            flexFlow={{ base: 'column', md: 'row' }}
            textAlign='center'
          >
            <Image src={logo} alt='Logo' boxSize='140px' />
            <Stack fontWeight='900' alignItems='end' color='basi.500'>
              <Text as='span' fontSize='7xl'>
                HEALPix
              </Text>
              <Text as='span' fontSize='4xl' mt={4}>
                deck.gl
              </Text>
            </Stack>
          </Heading>
          <Text fontSize='xl' textAlign='center' fontWeight='500'>
            GPU-accelerated HEALPix raster layers for deck.gl.
            <br />
            Render planetary-scale datasets directly in the browser.
          </Text>

          <Button
            variant='solid'
            size='lg'
            colorPalette='teal'
            borderRadius='md'
            asChild
          >
            <Link
              target='_blank'
              rel='noopener noreferrer'
              href='https://github.com/developmentseed/deck.gl-healpix'
              _hover={{ textDecoration: 'none' }}
            >
              <FaGithub /> View on GitHub
            </Link>
          </Button>
        </Stack>

        <List.Root
          unstyled
          maxW='6xl'
          mx='auto'
          display='flex'
          gap={8}
          flexWrap='wrap'
          justifyContent='center'
          mt={12}
        >
          {EXAMPLES.map((example) => (
            <List.Item key={example.title}>
              <Link
                href={example.href}
                borderRadius='md'
                backdropFilter='blur(4px)'
                bg='whiteAlpha.300'
                p={4}
                border='1px solid {colors.basi.200a}'
                maxW='20rem'
                flexFlow='column'
                alignItems='start'
                transition='background-color 320ms'
                _hover={{ bg: 'white', textDecoration: 'none' }}
              >
                <Image
                  src={example.image}
                  alt={example.title}
                  borderRadius='md'
                  mb={4}
                />
                <Heading as='h2' fontSize='2xl'>
                  {example.title}
                </Heading>
                <Text>{example.description}</Text>
              </Link>
            </List.Item>
          ))}
        </List.Root>
      </Stack>
    </Flex>
  );
}
