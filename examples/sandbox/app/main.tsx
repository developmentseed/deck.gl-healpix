import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes } from 'react-router';

import PageAnimation from '$pages/animation';
import PageColor from '$pages/color';
import { PageLayout } from '$shared/components/page-layout';

// Root component.
function Root() {
  useEffect(() => {
    dispatchEvent(new Event('app-ready'));
  }, []);

  return (
    <PageLayout
      title='HEALPix Sandbox'
      navItems={[
        { label: 'Cell Rendering', to: '/' },
        { label: 'Color Visualization', to: '/color' }
      ]}
    >
      <Routes>
        <Route path='/' element={<PageAnimation />} />
        <Route path='/color' element={<PageColor />} />
      </Routes>
    </PageLayout>
  );
}

const rootNode = document.querySelector('#app-container')!;
const root = createRoot(rootNode);
root.render(<Root />);
