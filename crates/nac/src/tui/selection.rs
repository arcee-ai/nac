use super::*;

pub(super) fn selection_bounds_for_panel(
    selection: Option<&SelectionState>,
    panel: PanelId,
) -> Option<(SelectionPoint, SelectionPoint)> {
    let selection = selection?;
    if selection.anchor.panel != panel || selection.focus.panel != panel {
        return None;
    }
    let (start, end) = ordered_points(&selection.anchor, &selection.focus);
    Some((start.clone(), end.clone()))
}

pub(super) fn ordered_points<'a>(
    left: &'a SelectionPoint,
    right: &'a SelectionPoint,
) -> (&'a SelectionPoint, &'a SelectionPoint) {
    if compare_points(left, right).is_le() {
        (left, right)
    } else {
        (right, left)
    }
}

pub(super) fn compare_points(left: &SelectionPoint, right: &SelectionPoint) -> Ordering {
    left.logical_line
        .cmp(&right.logical_line)
        .then_with(|| left.char_index.cmp(&right.char_index))
}

pub(super) fn selection_overlap_for_row(
    row: &WrappedRow,
    start: &SelectionPoint,
    end: &SelectionPoint,
) -> Option<(usize, usize)> {
    if row.logical_line < start.logical_line || row.logical_line > end.logical_line {
        return None;
    }

    let row_start = row.start_char;
    let mut row_end = row.end_char;
    if row_start == row_end && row.text.is_empty() {
        row_end = row_start;
    }

    let selection_start = if row.logical_line == start.logical_line {
        start.char_index.max(row_start)
    } else {
        row_start
    };
    let selection_end = if row.logical_line == end.logical_line {
        end.char_index.min(row_end)
    } else {
        row_end
    };

    if selection_start >= selection_end {
        return None;
    }

    Some((
        selection_start.saturating_sub(row.start_char),
        selection_end.saturating_sub(row.start_char),
    ))
}

pub(super) fn extract_selection_text(view: &PanelView, selection: &SelectionState) -> String {
    let (start, end) = ordered_points(&selection.anchor, &selection.focus);
    if start.panel != view.id || end.panel != view.id {
        return String::new();
    }
    if compare_points(start, end) == Ordering::Equal {
        return String::new();
    }

    let mut out = String::new();
    for logical_line in start.logical_line..=end.logical_line {
        let Some(line) = view.logical_lines.get(logical_line) else {
            continue;
        };
        let line_len = line.chars().count();
        let start_char = if logical_line == start.logical_line {
            start.char_index.min(line_len)
        } else {
            0
        };
        let end_char = if logical_line == end.logical_line {
            end.char_index.min(line_len)
        } else {
            line_len
        };
        if end_char > start_char {
            out.push_str(&slice_chars(line, start_char, end_char));
        }
        if logical_line < end.logical_line {
            out.push('\n');
        }
    }
    out
}

pub(super) fn slice_chars(text: &str, start: usize, end: usize) -> String {
    text.chars()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect()
}
