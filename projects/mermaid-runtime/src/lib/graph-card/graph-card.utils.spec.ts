import { computeGraphProgress, resetGraphStatuses } from './graph-card.utils';
import { MermaidRuntime } from '../task-graph-model';

describe('graph-card.utils', () => {
  describe('computeGraphProgress', () => {
    it('returns zero metrics for null or empty graphs', () => {
      expect(computeGraphProgress(null)).toEqual({
        total: 0,
        done: 0,
        running: 0,
        failed: 0,
        percent: 0,
      });

      expect(computeGraphProgress(undefined)).toEqual({
        total: 0,
        done: 0,
        running: 0,
        failed: 0,
        percent: 0,
      });

      expect(computeGraphProgress({ nodes: [] })).toEqual({
        total: 0,
        done: 0,
        running: 0,
        failed: 0,
        percent: 0,
      });
    });

    it('correctly calculates completed, running, failed and percentage', () => {
      const graph: MermaidRuntime.Graph = {
        nodes: [
          { id: '1', title: 'Step 1', status: 'complete' },
          { id: '2', title: 'Step 2', status: 'done' },
          { id: '3', title: 'Step 3', status: 'skipped' },
          { id: '4', title: 'Step 4', status: 'running' },
          { id: '5', title: 'Step 5', status: 'failed' },
          { id: '6', title: 'Step 6', status: 'undone' },
        ],
      };

      const result = computeGraphProgress(graph);
      expect(result.total).toBe(6);
      expect(result.done).toBe(3); // complete + done + skipped
      expect(result.running).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.percent).toBe(50); // 3 of 6 = 50%
    });

    it('handles 100% completion correctly', () => {
      const graph: MermaidRuntime.Graph = {
        nodes: [
          { id: '1', title: 'Step 1', status: 'complete' },
          { id: '2', title: 'Step 2', status: 'complete' },
        ],
      };

      const result = computeGraphProgress(graph);
      expect(result.total).toBe(2);
      expect(result.done).toBe(2);
      expect(result.percent).toBe(100);
    });
  });

  describe('resetGraphStatuses', () => {
    it('clones and resets node statuses to undone by default', () => {
      const source: MermaidRuntime.Graph = {
        nodes: [
          { id: 'a', title: 'A', status: 'complete' },
          { id: 'b', title: 'B', status: 'failed' },
        ],
        transitions: [{ from: 'a', to: 'b' }],
      };

      const reset = resetGraphStatuses(source);
      expect(reset).not.toBe(source);
      expect(reset.nodes[0].status).toBe('undone');
      expect(reset.nodes[1].status).toBe('undone');
      expect(source.nodes[0].status).toBe('complete'); // Unmutated source
      expect(reset.transitions).toEqual(source.transitions);
    });

    it('resets to a custom status and recurses into nested subgraphs', () => {
      const source: MermaidRuntime.Graph = {
        nodes: [
          {
            id: 'parent',
            title: 'Parent',
            status: 'running',
            subgraph: {
              nodes: [{ id: 'child', title: 'Child', status: 'complete' }],
            },
          },
        ],
      };

      const reset = resetGraphStatuses(source, 'idle');
      expect(reset.nodes[0].status).toBe('idle');
      expect(reset.nodes[0].subgraph?.nodes[0].status).toBe('idle');
      expect(source.nodes[0].status).toBe('running'); // Unmutated
    });
  });
});
