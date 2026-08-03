import { getLoginFlow, OryPageParams } from "@ory/nextjs/app";
import { Login } from "@ory/elements-react/theme";
import "@ory/elements-react/theme/styles.css";
import { oryConfig } from "@/app/lib/ory-config";

export default async function KratosLoginPage(props: OryPageParams) {
  const flow = await getLoginFlow(oryConfig, props.searchParams);

  if (!flow) {
    return null;
  }

  return <Login flow={flow} config={oryConfig} />;
}
