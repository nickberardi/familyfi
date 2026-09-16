"use client";

/**
 * Swagger UI, mounted from swagger-ui-dist rather than swagger-ui-react.
 *
 * swagger-client resolves an OpenAPI 3.1 document through apidom
 * (`OpenApi3_1Element.refract`). Bundled by Next, that binding comes back
 * without `refract`, so every operation's subtree resolution throws and the
 * body spins forever. The dist bundle is prebuilt by Swagger's own toolchain
 * with apidom already linked, so nothing is left for Next to mis-resolve.
 */

import { useEffect, useRef } from "react";
import SwaggerUIBundle from "swagger-ui-dist/swagger-ui-bundle.js";
import "swagger-ui-dist/swagger-ui.css";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/constants";

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function ApiReference() {
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!node.current) return;
    SwaggerUIBundle({
      domNode: node.current,
      url: "/openapi",
      deepLinking: true,
      docExpansion: "list",
      defaultModelsExpandDepth: 0,
      tryItOutEnabled: true,
      withCredentials: true,
      requestInterceptor: (request) => {
        const method = (request.method ?? "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          request.headers[CSRF_HEADER] = csrfToken();
        }
        return request;
      },
    });
  }, []);

  return <div ref={node} />;
}
