import * as React from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface EmailShellProps {
  preview: string;
  siteName?: string;
  siteUrl?: string;
  children: React.ReactNode;
}

export function EmailShell({
  preview,
  siteName = "Apis Financial",
  siteUrl = "https://apisfinancial.app",
  children,
}: EmailShellProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandBar}>
            <Text style={brandMark}>⬡</Text>
            <Link href={siteUrl} style={brandName}>
              {siteName}
            </Link>
          </Section>
          <Section style={content}>{children}</Section>
          <Hr style={rule} />
          <Text style={legal}>
            Apis Financial · Canadian portfolio tracking and retirement planning
          </Text>
          <Text style={legal}>
            This is an automated account-security message. Please do not reply.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const emailStyles = {
  heading: {
    color: "#1c1508",
    fontSize: "26px",
    fontWeight: "700" as const,
    lineHeight: "1.25",
    margin: "0 0 18px",
  },
  text: {
    color: "#5f4b2d",
    fontSize: "15px",
    lineHeight: "1.65",
    margin: "0 0 20px",
  },
  link: {
    color: "#92400e",
    textDecoration: "underline",
  },
  button: {
    backgroundColor: "#b45309",
    borderRadius: "6px",
    color: "#fffdf6",
    display: "inline-block",
    fontSize: "15px",
    fontWeight: "700" as const,
    padding: "13px 22px",
    textDecoration: "none",
  },
  note: {
    backgroundColor: "#fffbeb",
    borderLeft: "3px solid #f59e0b",
    color: "#7c6544",
    fontSize: "13px",
    lineHeight: "1.55",
    margin: "28px 0 0",
    padding: "12px 14px",
  },
  code: {
    backgroundColor: "#fffbeb",
    border: "1px solid #ead7ad",
    borderRadius: "6px",
    color: "#1c1508",
    fontFamily: "Courier New, monospace",
    fontSize: "28px",
    fontWeight: "700" as const,
    letterSpacing: "6px",
    margin: "4px 0 24px",
    padding: "18px 20px",
    textAlign: "center" as const,
  },
};

const main = {
  backgroundColor: "#ffffff",
  fontFamily: "Arial, Helvetica, sans-serif",
  margin: "0",
  padding: "32px 12px",
};

const container = {
  border: "1px solid #ead7ad",
  borderRadius: "8px",
  margin: "0 auto",
  maxWidth: "560px",
  overflow: "hidden",
};

const brandBar = {
  backgroundColor: "#1c1508",
  padding: "20px 28px",
};

const brandMark = {
  color: "#fbbf24",
  display: "inline-block",
  fontSize: "24px",
  lineHeight: "1",
  margin: "0 10px 0 0",
  verticalAlign: "middle",
};

const brandName = {
  color: "#fff7df",
  display: "inline-block",
  fontSize: "18px",
  fontWeight: "700" as const,
  textDecoration: "none",
  verticalAlign: "middle",
};

const content = { padding: "34px 28px 28px" };
const rule = { borderColor: "#ead7ad", margin: "0 28px 18px" };
const legal = {
  color: "#8a7657",
  fontSize: "11px",
  lineHeight: "1.5",
  margin: "0 28px 7px",
  paddingBottom: "4px",
};
