import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'testing/layout-regression', loadComponent: () => import('./testing/layout-regression.page').then(m => m.LayoutRegressionPage) },
  { path: 'fullscreen', loadComponent: () => import('./pages/fullscreen.page').then(m => m.FullscreenPage) },
  { path: 'constrained', loadComponent: () => import('./pages/constrained.page').then(m => m.ConstrainedPage) },
  { path: 'subgraphs', loadComponent: () => import('./pages/subgraphs.page').then(m => m.SubgraphsPage) },
  { path: 'replay', loadComponent: () => import('./pages/replay.page').then(m => m.ReplayPage) },
  { path: '', pathMatch: 'full', redirectTo: 'fullscreen' },
  { path: '**', redirectTo: 'fullscreen' },
];
