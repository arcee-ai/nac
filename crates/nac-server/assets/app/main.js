import { React, html } from "./lib/html.js";
import {
  Icon,
  Loader,
  LoaderSize,
  LoaderVariant,
  Button,
  ButtonSize,
  ButtonVariant,
  ButtonContent,
  Badge,
  BadgeColor,
  TabButton,
  TabButtonVariant,
  HorizontalTabsItem,
  Tooltip,
  TooltipPosition,
  Input,
  InputSize,
  InputLeading,
  InputTrailing,
  Select,
  Modal,
  ModalSize,
  ToastVariant,
  showToast,
} from "./atoms/index.js";

const { useState } = React;
const { createRoot } = window.ReactDOM;

function Section({ title, children }) {
  return html`
    <section class="flex flex-col gap-3">
      <div class="tag-label text-basic-muted">${title}</div>
      <div class="flex flex-wrap items-center gap-3 p-4 rounded-2xl bg-elevation-level-1 border border-secondary">
        ${children}
      </div>
    </section>
  `;
}

function App() {
  const [tab, setTab] = useState("chat");
  const [modelId, setModelId] = useState("gpt-4");
  const [modalOpen, setModalOpen] = useState(false);

  const models = [
    { id: "gpt-4", label: "GPT-4", icon: "ai" },
    { id: "claude", label: "Claude", icon: "brain" },
    { id: "local", label: "Local model", icon: "provider" },
  ];

  return html`
    <div class="min-h-screen flex flex-col gap-8 p-8 max-w-5xl mx-auto">
      <header class="flex items-center justify-between">
        <div>
          <div class="header-big text-basic-primary">nac · atomy (Step 2)</div>
          <div class="label-micro text-shimmer-accent">Button · Icon · Loader · Badge · Tabs · Tooltip · Input · Select · Modal · Toast</div>
        </div>
        <${Button} variant=${ButtonVariant.Primary} size=${ButtonSize.Medium} content=${ButtonContent.IconLeft} onClick=${() => setModalOpen(true)}>
          <${Icon} name="add" />
          Nowa sesja
        </${Button}>
      </header>

      <${Section} title="Button — warianty">
        <${Button} variant=${ButtonVariant.Primary}>Primary</${Button}>
        <${Button} variant=${ButtonVariant.Secondary}>Secondary</${Button}>
        <${Button} variant=${ButtonVariant.SecondaryAccent}>Accent</${Button}>
        <${Button} variant=${ButtonVariant.SecondaryDestructive}>Destructive</${Button}>
        <${Button} variant=${ButtonVariant.Ghost}>Ghost</${Button}>
        <${Button} variant=${ButtonVariant.Tertiary}>Tertiary</${Button}>
        <${Button} variant=${ButtonVariant.Primary} disabled=${true}>Disabled</${Button}>
        <${Button} variant=${ButtonVariant.Primary} loading=${true}>Loading</${Button}>
      </${Section}>

      <${Section} title="Button — rozmiary + ikony">
        <${Button} variant=${ButtonVariant.Secondary} size=${ButtonSize.Small} content=${ButtonContent.IconLeft}>
          <${Icon} name="play" /> Small
        </${Button}>
        <${Button} variant=${ButtonVariant.Secondary} size=${ButtonSize.Medium} content=${ButtonContent.IconLeft}>
          <${Icon} name="play" /> Medium
        </${Button}>
        <${Button} variant=${ButtonVariant.Secondary} size=${ButtonSize.Large} content=${ButtonContent.IconLeft}>
          <${Icon} name="play" /> Large
        </${Button}>
        <${Button} variant=${ButtonVariant.SecondaryAccent} content=${ButtonContent.Icon}>
          <${Icon} name="gear" />
        </${Button}>
      </${Section}>

      <${Section} title="Icon">
        ${["home", "chat", "search", "gear", "trash", "edit", "folder", "code", "check", "close", "brain", "provider"].map(
          (n) => html`<${Icon} key=${n} name=${n} size=${24} color="var(--color-text-basic-secondary)" />`,
        )}
      </${Section}>

      <${Section} title="Loader">
        <${Loader} size=${LoaderSize.Small} variant=${LoaderVariant.Brand} />
        <${Loader} size=${LoaderSize.Medium} variant=${LoaderVariant.Neutral} />
        <${Loader} size=${LoaderSize.Large} variant=${LoaderVariant.Destructive} />
      </${Section}>

      <${Section} title="Badge">
        <${Badge} text="Neutral" color=${BadgeColor.Neutral} />
        <${Badge} text="Running" color=${BadgeColor.Green} />
        <${Badge} text="Info" color=${BadgeColor.Blue} />
        <${Badge} text="Failed" color=${BadgeColor.Red} />
        <${Badge} text="Queued" color=${BadgeColor.Yellow} />
        <${Badge} text="Draft" color=${BadgeColor.Gray} />
      </${Section}>

      <${Section} title="Tabs (poziome)">
        <div class="flex gap-1 border-b border-primary w-full">
          <${HorizontalTabsItem} active=${tab === "chat"} iconName="chat" onClick=${() => setTab("chat")}>Chat</${HorizontalTabsItem}>
          <${HorizontalTabsItem} active=${tab === "files"} iconName="folder" onClick=${() => setTab("files")}>Pliki</${HorizontalTabsItem}>
          <${HorizontalTabsItem} active=${tab === "logs"} iconName="terminal" onClick=${() => setTab("logs")}>Logi</${HorizontalTabsItem}>
        </div>
      </${Section}>

      <${Section} title="Tooltip (hover)">
        <${Tooltip} title="Uruchom agenta" description="Skrót: ⌘⏎" position=${TooltipPosition.TopCenter} keyboardShortcuts=${["⌘", "⏎"]}>
          <${Button} variant=${ButtonVariant.SecondaryAccent} content=${ButtonContent.Icon}><${Icon} name="play" /></${Button}>
        </${Tooltip}>
        <${Tooltip} title="Usuń sesję" position=${TooltipPosition.BottomCenter}>
          <${Button} variant=${ButtonVariant.SecondaryDestructive} content=${ButtonContent.Icon}><${Icon} name="trash" /></${Button}>
        </${Tooltip}>
      </${Section}>

      <${Section} title="Input">
        <${Input} inputSize=${InputSize.Medium} label="Nazwa sesji" placeholder="np. Refaktor API" className="w-64" />
        <${Input} inputSize=${InputSize.Medium} leading=${InputLeading.Icon} leadingIconName="search" placeholder="Szukaj…" className="w-64" />
        <${Input} inputSize=${InputSize.Medium} trailing=${InputTrailing.Button} trailingIconName="add" placeholder="Dodaj tag" className="w-64" />
        <${Input} inputSize=${InputSize.Medium} label="Błąd walidacji" validation=${true} validationText="Pole wymagane" placeholder="…" className="w-64" />
      </${Section}>

      <${Section} title="Select">
        <${Select} items=${models} value=${modelId} onValueChange=${setModelId} placeholder="Wybierz model" />
        <span class="label-small text-basic-tertiary">Wybrano: ${modelId}</span>
      </${Section}>

      <${Section} title="Modal / Toast">
        <${Button} variant=${ButtonVariant.Secondary} onClick=${() => setModalOpen(true)}>Otwórz modal</${Button}>
        <${Button} variant=${ButtonVariant.Ghost} onClick=${() => showToast("Zapisano zmiany", ToastVariant.Success)}>Toast success</${Button}>
        <${Button} variant=${ButtonVariant.GhostDestructive} onClick=${() => showToast("Coś poszło nie tak", ToastVariant.Error)}>Toast error</${Button}>
      </${Section}>

      <${Modal}
        open=${modalOpen}
        onClose=${() => setModalOpen(false)}
        title="Nowa sesja"
        size=${ModalSize.Small}
        footer=${html`
          <${Button} variant=${ButtonVariant.Ghost} onClick=${() => setModalOpen(false)}>Anuluj</${Button}>
          <${Button} variant=${ButtonVariant.Primary} onClick=${() => { setModalOpen(false); showToast("Sesja utworzona", ToastVariant.Success); }}>Utwórz</${Button}>
        `}
      >
        <div class="flex flex-col gap-3">
          <${Input} inputSize=${InputSize.Medium} label="Tytuł" placeholder="np. Refaktor API" />
          <${Select} items=${models} value=${modelId} onValueChange=${setModelId} className="w-full" />
        </div>
      </${Modal}>
    </div>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
