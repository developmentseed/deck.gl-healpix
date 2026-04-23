import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes } from 'react-router';

import PageAnimation from '$pages/animation';
import { PageLayout } from '$shared/components/page-layout';

// Root component.
function Root() {
  useEffect(() => {
    dispatchEvent(new Event('app-ready'));
  }, []);

  return (
    <PageLayout title='HEALPix Sandbox'>
      <Routes>
        <Route path='/' element={<PageAnimation />} />
      </Routes>
    </PageLayout>
  );
}

const rootNode = document.querySelector('#app-container')!;
const root = createRoot(rootNode);
root.render(<Root />);
