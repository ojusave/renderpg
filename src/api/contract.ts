import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

// Contract is the source for route validation and response serialization.
export const contract = parse(readFileSync(path.resolve('openapi.yaml'), 'utf8')) as Record<string, any>;
export function expand(value: any): any {
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === 'object') {
    if (value.$ref) {
      if (!value.$ref.startsWith('#/')) throw new Error('Only local OpenAPI references are allowed');
      const resolved = value.$ref.slice(2).split('/').reduce((node: any, key: string) => node[key], contract);
      if (!resolved) throw new Error(`Unresolved schema reference: ${value.$ref}`);
      return expand(resolved);
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
  }
  return value;
}
export function routeSchema(route: string, method: string) {
  const pathItem = contract.paths[route];
  const operation = pathItem[method];
  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map(expand);
  const params = parameters.filter(p => p.in === 'path');
  const headers = parameters.filter(p => p.in === 'header');
  const response = Object.fromEntries(Object.entries(operation.responses).map(([status, raw]) => {
    const item = expand(raw);
    return [status, item.content['application/json'].schema];
  }));
  return {
    ...(operation.requestBody ? { body: expand(operation.requestBody.content['application/json'].schema) } : {}),
    ...(params.length ? { params: { type: 'object', properties: Object.fromEntries(params.map(p => [p.name, p.schema])), required: params.map(p => p.name), additionalProperties: false } } : {}),
    ...(headers.length ? { headers: { type: 'object', properties: Object.fromEntries(headers.map(p => [p.name.toLowerCase(), p.schema])), required: headers.map(p => p.name.toLowerCase()) } } : {}),
    response,
  };
}
