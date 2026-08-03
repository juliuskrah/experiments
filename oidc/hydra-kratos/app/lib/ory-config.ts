import type { OryClientConfiguration } from "@ory/elements-react";

function kratosPublicUrl(): string {
  const url = process.env.KRATOS_PUBLIC_URL;
  if (!url) {
    throw new Error("KRATOS_PUBLIC_URL environment variable is not set");
  }
  return url;
}

export const oryConfig: OryClientConfiguration = {
  sdk: {
    url: kratosPublicUrl(),
  },
  project: {
    name: "dex-via-kratos",
    default_redirect_url: "/",
    error_ui_url: "/kratos/error",
    login_ui_url: "/kratos/login",
    registration_ui_url: "/kratos/registration",
    registration_enabled: true,
    recovery_ui_url: "/kratos/recovery",
    recovery_enabled: true,
    settings_ui_url: "/kratos/settings",
    verification_ui_url: "/kratos/verification",
    verification_enabled: true,
  },
};
