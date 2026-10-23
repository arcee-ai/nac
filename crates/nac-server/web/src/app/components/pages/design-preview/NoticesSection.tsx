import {
  BoxSurface,
  ChatSessionMessage,
  ChatSessionMessageVariant,
  CircularLoader,
  LoaderSize,
  MessageBox,
  MessageBoxVariant,
  ProgressLoader,
  ShimmerLoader,
} from "@/app/atoms";

export function NoticesSection() {
  return (
    <BoxSurface title="Notices and loaders">
      <div className="p-4 flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          <MessageBox
            variant={MessageBoxVariant.Info}
            title="Read-only snapshot"
            className="w-[280px]"
          >
            Pick the working tree to edit files again.
          </MessageBox>
          <MessageBox variant={MessageBoxVariant.Error} title="Run failed" className="w-[280px]">
            The provider rejected the request.
          </MessageBox>
          <MessageBox
            variant={MessageBoxVariant.Success}
            title="Branch switched"
            className="w-[280px]"
          />
        </div>
        <div className="flex flex-col gap-2 w-[398px]">
          <ChatSessionMessage
            variant={ChatSessionMessageVariant.Danger}
            title="Message Title"
            action={{ label: "Message CTA", onClick: () => {} }}
          >
            Message description
          </ChatSessionMessage>
          <ChatSessionMessage
            variant={ChatSessionMessageVariant.Error}
            title="Message Title"
            action={{ label: "Message CTA", onClick: () => {} }}
          >
            Message description
          </ChatSessionMessage>
          <ChatSessionMessage
            variant={ChatSessionMessageVariant.Success}
            title="Message Title"
            action={{ label: "Message CTA", onClick: () => {} }}
          >
            Message description
          </ChatSessionMessage>
          <ChatSessionMessage
            variant={ChatSessionMessageVariant.Info}
            title="Message Title"
            action={{ label: "Message CTA", onClick: () => {} }}
          >
            Message description
          </ChatSessionMessage>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <CircularLoader size={LoaderSize.Medium} />
          <ShimmerLoader rows={3} className="w-[200px]" />
          <ProgressLoader active className="w-[200px]" />
        </div>
      </div>
    </BoxSurface>
  );
}
