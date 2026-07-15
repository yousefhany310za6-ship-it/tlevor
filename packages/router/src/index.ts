import type { HTTPMethod, RouteHandler } from '@tlevor/types';

interface RouteNode {
  path: string;
  children: Map<string, RouteNode>;
  paramChild: RouteNode | null;
  paramName: string | null;
  wildcardChild: RouteNode | null;
  handlers: Map<HTTPMethod, RouteHandler>;
  methods: Set<HTTPMethod>;
  isWildcard: boolean;
}

interface MatchResult {
  handler: RouteHandler;
  method: HTTPMethod;
  params: Record<string, string>;
}

function createNode(path: string = ''): RouteNode {
  return {
    path,
    children: new Map(),
    paramChild: null,
    paramName: null,
    wildcardChild: null,
    handlers: new Map(),
    methods: new Set(),
    isWildcard: false,
  };
}

export class Router {
  private root: RouteNode;
  private routeCount: number = 0;

  constructor() {
    this.root = createNode('/');
  }

  addRoute(method: HTTPMethod | HTTPMethod[], path: string, handler: RouteHandler): void {
    const methods = Array.isArray(method) ? method : [method];
    const normalizedPath = this.normalizePath(path);

    let current = this.root;
    const segments = normalizedPath.split('/').filter(Boolean);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      if (segment.startsWith(':')) {
        const paramName = segment.slice(1);
        if (!current.paramChild) {
          current.paramChild = createNode(segment);
        }
        current.paramChild.paramName = paramName;
        current = current.paramChild;
      } else if (segment === '*') {
        if (!current.wildcardChild) {
          current.wildcardChild = createNode('*');
          current.wildcardChild.isWildcard = true;
        }
        current = current.wildcardChild;
      } else {
        if (!current.children.has(segment)) {
          current.children.set(segment, createNode(segment));
        }
        current = current.children.get(segment)!;
      }
    }

    for (const m of methods) {
      current.methods.add(m);
      current.handlers.set(m, handler);
    }
    this.routeCount++;
  }

  findRoute(method: HTTPMethod, path: string): MatchResult | null {
    const normalizedPath = this.normalizePath(path);
    const segments = normalizedPath.split('/').filter(Boolean);

    const result = this.matchNode(this.root, segments, 0, {});
    if (!result) {
      return null;
    }

    return result;
  }

  private matchNode(
    node: RouteNode,
    segments: string[],
    index: number,
    params: Record<string, string>
  ): MatchResult | null {
    if (index === segments.length) {
      // Check if this node has a handler for any method
      if (node.methods.size > 0) {
        // Return the first available handler (will be filtered by method later)
        for (const [method, handler] of node.handlers) {
          return { handler, method, params };
        }
      }
      return null;
    }

    const segment = segments[index];

    // Try exact match first
    const exactChild = node.children.get(segment);
    if (exactChild) {
      const result = this.matchNode(exactChild, segments, index + 1, params);
      if (result) return result;
    }

    // Try parameter match
    if (node.paramChild) {
      const paramName = node.paramChild.paramName!;
      const newParams = { ...params, [paramName]: segment };
      const result = this.matchNode(node.paramChild, segments, index + 1, newParams);
      if (result) return result;
    }

    // Try wildcard match
    if (node.wildcardChild) {
      const wildcardPath = segments.slice(index).join('/');
      const newParams = { ...params, '*': wildcardPath };
      for (const [method, handler] of node.wildcardChild.handlers) {
        return { handler, method, params: newParams };
      }
    }

    return null;
  }

  findRouteByMethod(method: HTTPMethod, path: string): MatchResult | null {
    const normalizedPath = this.normalizePath(path);
    const segments = normalizedPath.split('/').filter(Boolean);

    return this.matchNodeByMethod(this.root, segments, 0, {}, method);
  }

  private matchNodeByMethod(
    node: RouteNode,
    segments: string[],
    index: number,
    params: Record<string, string>,
    method: HTTPMethod
  ): MatchResult | null {
    if (index === segments.length) {
      if (node.handlers.has(method)) {
        return { handler: node.handlers.get(method)!, method, params };
      }
      return null;
    }

    const segment = segments[index];

    const exactChild = node.children.get(segment);
    if (exactChild) {
      const result = this.matchNodeByMethod(exactChild, segments, index + 1, params, method);
      if (result) return result;
    }

    if (node.paramChild) {
      const paramName = node.paramChild.paramName!;
      const newParams = { ...params, [paramName]: segment };
      const result = this.matchNodeByMethod(node.paramChild, segments, index + 1, newParams, method);
      if (result) return result;
    }

    if (node.wildcardChild) {
      const wildcardPath = segments.slice(index).join('/');
      const newParams = { ...params, '*': wildcardPath };
      if (node.wildcardChild.handlers.has(method)) {
        return { handler: node.wildcardChild.handlers.get(method)!, method, params: newParams };
      }
    }

    return null;
  }

  private normalizePath(path: string): string {
    if (path === '/') return '/';
    return path.endsWith('/') ? path.slice(0, -1) : path;
  }

  getRouteCount(): number {
    return this.routeCount;
  }

  getRoutes(): Array<{ method: HTTPMethod; path: string }> {
    const routes: Array<{ method: HTTPMethod; path: string }> = [];
    this.collectRoutes(this.root, '', routes);
    return routes;
  }

  private collectRoutes(
    node: RouteNode,
    currentPath: string,
    routes: Array<{ method: HTTPMethod; path: string }>
  ): void {
    for (const method of node.methods) {
      routes.push({ method, path: currentPath || '/' });
    }

    for (const [segment, child] of node.children) {
      this.collectRoutes(child, `${currentPath}/${segment}`, routes);
    }

    if (node.paramChild) {
      this.collectRoutes(node.paramChild, `${currentPath}/${node.paramChild.path}`, routes);
    }

    if (node.wildcardChild) {
      this.collectRoutes(node.wildcardChild, `${currentPath}/*`, routes);
    }
  }
}
