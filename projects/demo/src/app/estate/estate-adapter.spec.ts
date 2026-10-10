import { ESTATE_REGISTRY } from './estate-data';
import { buildEstateGraph, expandTemplate, linksFor, resolveFeature, syncSummaries } from './estate-adapter';

const feature = (id: string) => ESTATE_REGISTRY.features.find(f => f.id === id)!;
const nodeIds = (g: ReturnType<typeof buildEstateGraph>) => g.nodes.map(n => n.id);

describe('estate adapter', () => {
  describe('resolveFeature', () => {
    it('follows outgoing links up to the depth', () => {
      const slice = resolveFeature(ESTATE_REGISTRY, { id: 't', name: 't', roots: ['orders-web'], depth: 1 });
      expect([...slice.componentIds].sort()).toEqual(['orders-api', 'orders-web']);
    });

    it('counts a sync link as one hop', () => {
      const slice = resolveFeature(ESTATE_REGISTRY, { id: 't', name: 't', roots: ['orders-api'], depth: 1 });
      expect(slice.componentIds.has('inventory-api')).toBeTrue();
      expect(slice.componentIds.has('inventory-db')).toBeFalse();
    });

    it('honours excludes and includes', () => {
      const slice = resolveFeature(ESTATE_REGISTRY, { id: 't', name: 't', roots: ['orders-web'], include: ['users-api'], exclude: ['payments-api'], depth: 3 });
      expect(slice.componentIds.has('payments-api')).toBeFalse();
      expect(slice.componentIds.has('users-api')).toBeTrue();
    });

    it('only keeps links whose ends are both in the slice', () => {
      const slice = resolveFeature(ESTATE_REGISTRY, feature('checkout'));
      expect(slice.links.every(l => slice.componentIds.has(l.from) && slice.componentIds.has(l.to))).toBeTrue();
    });
  });

  describe('buildEstateGraph', () => {
    const slice = resolveFeature(ESTATE_REGISTRY, feature('checkout'));

    it('draws a sync link as one labelled edge when collapsed', () => {
      const g = buildEstateGraph(ESTATE_REGISTRY, slice, { env: 'dev', expandSync: false });
      expect(g.transitions.some(t => t.from === 'orders-api' && t.to === 'inventory-api' && t.label === 'orders.created / OrderPlaced')).toBeTrue();
      expect(nodeIds(g)).not.toContain('orders-relay');
    });

    it('adds outbox table, consoles and topic when expanded', () => {
      const g = buildEstateGraph(ESTATE_REGISTRY, slice, { env: 'dev', expandSync: true });
      expect(nodeIds(g)).toEqual(jasmine.arrayContaining(['orders-db.order_outbox', 'orders-relay', 'orders.created', 'inventory-ingest']));
      expect(g.transitions.some(t => t.from === 'orders-api' && t.to === 'inventory-api')).toBeFalse();
    });

    it('skips the outbox hop for a direct-read link', () => {
      const g = buildEstateGraph(ESTATE_REGISTRY, slice, { env: 'dev', expandSync: true });
      expect(g.transitions.some(t => t.from === 'payments-api' && t.to === 'payments-publisher' && t.label === 'read')).toBeTrue();
      expect(nodeIds(g).filter(id => id.startsWith('payments-db.'))).toEqual([]);
    });

    it('shares hop nodes between links that use the same relay and topic', () => {
      const g = buildEstateGraph(ESTATE_REGISTRY, slice, { env: 'dev', expandSync: true });
      expect(nodeIds(g).filter(id => id === 'orders-relay').length).toBe(1);
      expect(nodeIds(g).filter(id => id === 'orders.created').length).toBe(1);
    });

    it('takes status from the chosen environment and falls back to unknown', () => {
      const qa = buildEstateGraph(ESTATE_REGISTRY, slice, { env: 'qa', expandSync: true });
      expect(qa.nodes.find(n => n.id === 'orders-relay')!.status).toBe('down');
      const local = buildEstateGraph(ESTATE_REGISTRY, resolveFeature(ESTATE_REGISTRY, feature('checkout')), { env: 'local', expandSync: true });
      expect(local.nodes.find(n => n.id === 'orders-api')!.status).toBe('healthy');
      expect(local.nodes.find(n => n.id === 'inventory-relay')?.status ?? 'unknown').toBe('unknown');
    });

    it('lets an outbox table take its database status', () => {
      const g = buildEstateGraph(ESTATE_REGISTRY, slice, { env: 'dev', expandSync: true, statusOverride: { 'orders-db': 'degraded' } });
      expect(g.nodes.find(n => n.id === 'orders-db.order_outbox')!.status).toBe('degraded');
    });

    it('groups nodes by domain with no node in two groups', () => {
      const g = buildEstateGraph(ESTATE_REGISTRY, slice, { env: 'dev', expandSync: true });
      const all = g.groups.flatMap(x => x.nodeIds);
      expect(new Set(all).size).toBe(all.length);
      expect(all.sort()).toEqual(nodeIds(g).sort());
    });
  });

  describe('links', () => {
    it('fills the template and leaves out links an environment does not have', () => {
      expect(expandTemplate('https://x.test/{env}/{id}', 'orders-api', 'qa')).toBe('https://x.test/qa/orders-api');
      const local = linksFor(ESTATE_REGISTRY, 'orders-api', 'local').map(l => l.label);
      expect(local).toEqual(['repo', 'app']);
      expect(linksFor(ESTATE_REGISTRY, 'orders-api', 'dev').map(l => l.label)).toEqual(['repo', 'app', 'build', 'release']);
    });

    it('describes sync links on both ends', () => {
      expect(syncSummaries(ESTATE_REGISTRY, 'orders-api').join('\n')).toContain('sends orders.created / OrderPlaced to inventory-api');
      expect(syncSummaries(ESTATE_REGISTRY, 'inventory-api').join('\n')).toContain('receives orders.created / OrderPlaced from orders-api');
    });
  });
});
