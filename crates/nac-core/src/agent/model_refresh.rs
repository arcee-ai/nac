//! Refresh a session’s model snapshot only between admitted operations.

use super::*;

impl Agent {
    pub(super) fn refresh_model_at_operation_boundary(&mut self) {
        let previous = self.client.supports_image_tool_results();
        self.client.refresh_codex_metadata_at_boundary();
        if let Some(light) = &mut self.tool_runtime.light_client {
            Arc::make_mut(light).refresh_codex_metadata_at_boundary();
        }
        if let Some(compaction) = &mut self.compaction {
            compaction.refresh_automatic_threshold(self.client.automatic_compaction_threshold());
        }
        let current = self.client.supports_image_tool_results();
        if previous != current {
            for definitions in [&mut self.base_tool_defs, &mut self.fallback_tool_defs] {
                if let Some(read) = definitions
                    .iter_mut()
                    .find(|tool| tool.function.name == "read")
                {
                    *read = tools::read::definition(current);
                }
            }
        }
    }

    pub(crate) fn enable_automatic_compaction(&mut self) {
        if let Some(compaction) = &mut self.compaction {
            compaction.set_automatic_threshold(self.client.automatic_compaction_threshold());
        }
    }
}
