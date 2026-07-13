import { TestBed } from '@angular/core/testing';
import { GraphCameraComponent } from './graph-camera.component';

describe('GraphCameraComponent', () => {
  it('emits the opposite graph direction from the built-in control', async () => {
    await TestBed.configureTestingModule({ imports: [GraphCameraComponent] }).compileComponents();
    const fixture = TestBed.createComponent(GraphCameraComponent);
    fixture.componentRef.setInput('direction', 'TD');
    const emitted: Array<'TD' | 'LR'> = [];
    fixture.componentInstance.directionChange.subscribe(value => emitted.push(value));
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.graph-camera__btn--direction') as HTMLButtonElement;
    button.click();

    expect(emitted).toEqual(['LR']);
    expect(button.getAttribute('aria-label')).toContain('left-to-right');
  });
});
