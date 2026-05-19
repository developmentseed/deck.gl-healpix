import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes } from 'react-router';

import PageZarrTiles from '$pages/zarr-tiles';
import { PageLayout } from '$shared/components/page-layout';

// Root component.
function Root() {
  useEffect(() => {
    dispatchEvent(new Event('app-ready'));
  }, []);

  return (
    <PageLayout
      title='HEALPix Sandbox'
      navItems={[{ label: 'Zarr Tiles', to: '/' }]}
    >
      <Routes>
        <Route path='/' element={<PageZarrTiles />} />
      </Routes>
    </PageLayout>
  );
}

const rootNode = document.querySelector('#app-container')!;
const root = createRoot(rootNode);
root.render(<Root />);
