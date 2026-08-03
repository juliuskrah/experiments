import { getRecoveryFlow, OryPageParams } from "@ory/nextjs/app";
import { Recovery } from "@ory/elements-react/theme";
import "@ory/elements-react/theme/styles.css";
import { oryConfig } from "@/app/lib/ory-config";

export default async function KratosRecoveryPage(props: OryPageParams) {
  const flow = await getRecoveryFlow(oryConfig, props.searchParams);

  if (!flow) {
    return null;
  }

  return <Recovery flow={flow} config={oryConfig} />;
}
