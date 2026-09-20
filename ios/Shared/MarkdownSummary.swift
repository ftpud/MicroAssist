import Foundation

struct SummarySection: Identifiable, Sendable {
    let id: String
    let title: String
    let items: [String]
}

enum MarkdownSummary {
    static func sections(from markdown: String, itemLimit: Int = 8) -> [SummarySection] {
        var title: String?
        var items: [String] = []
        var result: [SummarySection] = []
        var remaining = itemLimit

        func appendSection() {
            guard let title, remaining > 0 else { return }
            let kept = Array(items.prefix(remaining))
            if !kept.isEmpty {
                result.append(SummarySection(id: title, title: title, items: kept))
                remaining -= kept.count
            }
        }

        for rawLine in markdown.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("## ") {
                appendSection()
                title = String(line.dropFirst(3))
                items = []
            } else if line.hasPrefix("- ") {
                items.append(String(line.dropFirst(2)))
            }
        }
        appendSection()
        return result
    }
}
