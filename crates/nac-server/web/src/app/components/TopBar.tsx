import { useState } from "react";
import { Link } from "react-router-dom";

import { Logo } from "@/app/atoms";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { HeaderMenu } from "@/app/components/HeaderMenu";
import { ConfigurationsModal } from "@/app/components/modals/ConfigurationsModal";
import { SshConfigsModal } from "@/app/components/modals/SshConfigsModal";
import { routes } from "@/app/lib/routes";

// Figma "HeaderSurface": the same ground-to-transparent gradient stacked twice,
// spanning the bar plus a 28px overhang that fades the content scrolling below.
const GROUND_FADE =
  "linear-gradient(to bottom, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))";
const SURFACE_STYLE = { backgroundImage: `${GROUND_FADE}, ${GROUND_FADE}` };

export function TopBar() {
  const [configuring, setConfiguring] = useState(false);
  const [sshConfigs, setSshConfigs] = useState(false);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-10 flex items-center gap-4 h-[52px] px-4 py-2 shrink-0">
        <div
          className="absolute inset-x-0 top-0 -bottom-4 pointer-events-none"
          style={SURFACE_STYLE}
        />
        <div className="relative flex items-center gap-8 min-w-0">
          <Link
            to={routes.list()}
            className="shrink-0"
            aria-label="All sessions"
          >
            <Logo height={28} className="text-basic-primary" />
          </Link>
          <Breadcrumbs />
        </div>
        <div className="relative flex items-center gap-3 ml-auto shrink-0">
          <HeaderMenu
            onConfigurations={() => setConfiguring(true)}
            onSshConfigs={() => setSshConfigs(true)}
          />
        </div>
      </header>
      <ConfigurationsModal
        open={configuring}
        onClose={() => setConfiguring(false)}
      />
      <SshConfigsModal open={sshConfigs} onClose={() => setSshConfigs(false)} />
    </>
  );
}
