import SwiftUI
import WidgetKit

@main
struct MicroAssistWidgetBundle: WidgetBundle {
    var body: some Widget {
        MicroAssistWidget()
        if #available(iOSApplicationExtension 27.0, *) {
            MicroAssistFullPageWidget()
        }
    }
}
