import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly navItems = [
    { path: '/work-e2e', label: 'Work E2E' },
    { path: '/large-flow', label: 'Large-flow lab' },
    { path: '/fullscreen', label: 'Full screen' },
    { path: '/constrained', label: 'Constrained' },
    { path: '/subgraphs', label: 'Subgraphs & groups' },
    { path: '/replay', label: 'Replay' },
  ];
}
