import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { GraphCardComponent } from './graph-card.component';
import { GraphCardListComponent } from './graph-card-list.component';
import { MermaidRuntime } from '../task-graph-model';

@Component({
  imports: [GraphCardComponent, GraphCardListComponent],
  template: `
    <mr-graph-card-list [empty]="listEmpty" [emptyText]="'No runs found'">
      <span empty class="custom-empty">Custom empty message</span>
      <mr-graph-card
        [graph]="sampleGraph"
        [headerImageSrc]="headerImage"
        [title]="'Test Run'"
        [subtitle]="'Running phase 1'"
        (cardClick)="onCardClicked($event)"
      >
        <span badge class="custom-badge">VIP</span>
        <span meta class="custom-meta">Branch: main</span>
        <div body class="custom-body">Extra payload</div>
        <div actions class="custom-actions">
          <button type="button" class="action-btn" (click)="onActionClicked($event)">Retry</button>
        </div>
      </mr-graph-card>
    </mr-graph-card-list>
  `,
})
class TestHostComponent {
  listEmpty = false;
  cardClicked = false;
  actionClicked = false;
  headerImage: string | null = null;

  sampleGraph: MermaidRuntime.Graph | null = {
    nodes: [
      { id: '1', title: 'Init', status: 'complete' },
      { id: '2', title: 'Work', status: 'running' },
    ],
    transitions: [{ from: '1', to: '2' }],
  };

  onCardClicked(_evt: MouseEvent): void {
    this.cardClicked = true;
  }

  onActionClicked(_evt: MouseEvent): void {
    this.actionClicked = true;
  }
}

describe('GraphCardComponent & GraphCardListComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, GraphCardComponent, GraphCardListComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('GraphCardComponent', () => {
    it('renders title, subtitle, and projected slots', () => {
      const cardEl = fixture.debugElement.query(By.directive(GraphCardComponent));
      expect(cardEl).toBeTruthy();

      const titleEl = cardEl.query(By.css('.mr-graph-card__title'));
      expect(titleEl.nativeElement.textContent.trim()).toBe('Test Run');

      const subtitleEl = cardEl.query(By.css('.mr-graph-card__subtitle'));
      expect(subtitleEl.nativeElement.textContent.trim()).toBe('Running phase 1');

      const badgeEl = cardEl.query(By.css('.custom-badge'));
      expect(badgeEl.nativeElement.textContent.trim()).toBe('VIP');

      const metaEl = cardEl.query(By.css('.custom-meta'));
      expect(metaEl.nativeElement.textContent.trim()).toBe('Branch: main');

      const bodyEl = cardEl.query(By.css('.custom-body'));
      expect(bodyEl.nativeElement.textContent.trim()).toBe('Extra payload');
    });

    it('derives progress and status automatically from graph nodes', () => {
      const cardComponent = fixture.debugElement
        .query(By.directive(GraphCardComponent))
        .componentInstance as GraphCardComponent;

      // 1 done of 2 total nodes = 50%
      expect(cardComponent.resolvedProgress()).toBe(50);
      expect(cardComponent.resolvedStatus()).toBe('running');
    });

    it('emits cardClick when clicking on card body, but ignores clicks on inner buttons', () => {
      const cardEl = fixture.debugElement.query(By.directive(GraphCardComponent));
      const actionBtn = cardEl.query(By.css('.action-btn'));

      // Click button inside actions slot
      actionBtn.nativeElement.click();
      fixture.detectChanges();
      expect(host.actionClicked).toBeTrue();
      expect(host.cardClicked).toBeFalse();

      // Click card background
      cardEl.nativeElement.click();
      fixture.detectChanges();
      expect(host.cardClicked).toBeTrue();
    });

    it('supports static image header when headerImageSrc is passed', () => {
      host.sampleGraph = null;
      host.headerImage = 'https://example.com/thumb.png';
      fixture.detectChanges();

      const cardEl = fixture.debugElement.query(By.directive(GraphCardComponent));
      const imgEl = cardEl.query(By.css('.mr-graph-card__header-image'));
      expect(imgEl).toBeTruthy();
      expect(imgEl.nativeElement.getAttribute('src')).toBe('https://example.com/thumb.png');
    });
  });

  describe('GraphCardListComponent', () => {
    it('shows card content when empty is false', () => {
      const listEl = fixture.debugElement.query(By.directive(GraphCardListComponent));
      expect(listEl.nativeElement.classList).toContain('mr-graph-card-list--grid');
      expect(listEl.query(By.directive(GraphCardComponent))).toBeTruthy();
      expect(listEl.query(By.css('.mr-graph-card-list__empty'))).toBeFalsy();
    });

    it('shows empty slot when empty is true', () => {
      host.listEmpty = true;
      fixture.detectChanges();

      const listEl = fixture.debugElement.query(By.directive(GraphCardListComponent));
      const emptyContainer = listEl.query(By.css('.mr-graph-card-list__empty'));
      expect(emptyContainer).toBeTruthy();
      expect(emptyContainer.query(By.css('.custom-empty'))).toBeTruthy();
    });
  });
});
