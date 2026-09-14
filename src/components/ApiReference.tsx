"use client";

import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/constants";

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function ApiReference() {
  return (
    <SwaggerUI
      url="/openapi"
      deepLinking
      docExpansion="list"
      defaultModelsExpandDepth={0}
      tryItOutEnabled
      withCredentials
      requestInterceptor={(request) => {
        const method = (request.method ?? "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          request.headers[CSRF_HEADER] = csrfToken();
        }
        return request;
      }}
    />
  );
}
