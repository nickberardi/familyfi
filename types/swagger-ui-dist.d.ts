/**
 * swagger-ui-dist ships no types, and @types/swagger-ui-dist only declares the
 * package root — which also pulls in the standalone preset we do not mount.
 * We import the prebuilt bundle directly, so declare just that entry point.
 */
declare module "swagger-ui-dist/swagger-ui-bundle.js" {
  export interface SwaggerUIRequest {
    method?: string;
    headers: Record<string, string>;
  }

  export interface SwaggerUIConfig {
    domNode: HTMLElement;
    url?: string;
    spec?: object;
    deepLinking?: boolean;
    docExpansion?: "list" | "full" | "none";
    defaultModelsExpandDepth?: number;
    tryItOutEnabled?: boolean;
    withCredentials?: boolean;
    requestInterceptor?: (request: SwaggerUIRequest) => SwaggerUIRequest;
  }

  export default function SwaggerUIBundle(config: SwaggerUIConfig): unknown;
}

declare module "swagger-ui-dist/swagger-ui.css";
