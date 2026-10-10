export function command(path, synopsis, summary, options, effectClass, effectSummary, approvalClass, approvalWhen, states, recovery, examples, outputContract = "apn.cli.v1") {
    return {
        path,
        synopsis,
        summary,
        options,
        effect: { class: effectClass, summary: effectSummary },
        approval: { class: approvalClass, when: approvalWhen },
        output: {
            contract: outputContract,
            success_exit: 0,
            failure_exit: 1,
            success: outputContract === "apn.cli.v1" ? "One successful apn.cli.v1 envelope." : "The command-specific raw transport output.",
            failures: [outputContract === "apn.cli.v1" ? "One classified-failure apn.cli.v1 envelope." : "A classified command failure."],
        },
        states,
        recovery,
        examples,
    };
}
export function option(name, type, required, defaultValue, constraints, sensitivity) {
    return { name, type, required, default: defaultValue, constraints, sensitivity };
}
//# sourceMappingURL=command-catalog-builders.js.map