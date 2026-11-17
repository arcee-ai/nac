import {
  BoxSurface,
  ChatSessionMessage,
  ChatSessionMessageVariant,
  MessageBox,
  MessageBoxVariant,
} from "@/app/atoms";

export function NoticesSection() {
  return (
    <BoxSurface title="Notices">
      <div className="p-4 flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          <MessageBox
            variant={MessageBoxVariant.Info}
            title="Read-only snapshot"
            className="w-full max-w-[280px]"
          >
            Pick the working tree to edit files again.
          </MessageBox>
          <MessageBox
            variant={MessageBoxVariant.Error}
            title="Run failed"
            className="w-full max-w-[280px]"
          >
            The provider rejected the request.
          </MessageBox>
          <MessageBox
            variant={MessageBoxVariant.Success}
            title="Branch switched"
            className="w-full max-w-[280px]"
          />
        </div>
        <div className="flex w-full max-w-[398px] flex-col gap-2">
          <ChatSessionMessage
            variant={ChatSessionMessageVariant.Danger}
            title="Needs your answer"
            action={{ label: "Open", onClick: () => {} }}
          >
            One line that says what happened and what to do next.
          </ChatSessionMessage>
          <ChatSessionMessage
            variant={ChatSessionMessageVariant.Error}
            title="Provider rejected the request"
            action={{ label: "Open", onClick: () => {} }}
          >
            One line that says what happened and what to do next.
          </ChatSessionMessage>
          <ChatSessionMessage
            variant={ChatSessionMessageVariant.Success}
            title="Branch merged"
            action={{ label: "Open", onClick: () => {} }}
          >
            One line that says what happened and what to do next.
          </ChatSessionMessage>
          <ChatSessionMessage
            variant={ChatSessionMessageVariant.Info}
            title="Snapshot restored"
            action={{ label: "Open", onClick: () => {} }}
          >
            One line that says what happened and what to do next.
          </ChatSessionMessage>
        </div>
      </div>
    </BoxSurface>
  );
}
