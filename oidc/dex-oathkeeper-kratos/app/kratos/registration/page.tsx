import { getRegistrationFlow, OryPageParams } from "@ory/nextjs/app";
import { Registration } from "@ory/elements-react/theme";
import "@ory/elements-react/theme/styles.css";
import { oryConfig } from "@/app/lib/ory-config";

export default async function KratosRegistrationPage(props: OryPageParams) {
  const flow = await getRegistrationFlow(oryConfig, props.searchParams);

  if (!flow) {
    return null;
  }

  return <Registration flow={flow} config={oryConfig} />;
}
