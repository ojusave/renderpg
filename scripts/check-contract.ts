import SwaggerParser from '@apidevtools/swagger-parser';
await SwaggerParser.validate('openapi.yaml');
console.log('OpenAPI contract is valid.');
