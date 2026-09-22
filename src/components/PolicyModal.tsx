import { useState, useEffect } from "react";

export default function PolicyModal({ type, onClose }: { type: "terms" | "privacy"; onClose: () => void }) {
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/${type}.md`)
            .then((r) => r.text())
            .then((text) => {
                setContent(text);
                setLoading(false);
            });
    }, [type]);

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70"
            onClick={(e) => {
                e.stopPropagation();
                onClose();
            }}
        >
            <div
                className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl bg-[#ffffff] shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onClose}
                    className="absolute right-6 top-6 z-10 text-gray-500 hover:text-gray-600"
                >
                    ✕
                </button>
                <div className="h-full overflow-y-auto p-8 thin-scrollbar">
                    {loading ? (
                        <p className="text-gray-500 text-center">加载中...</p>
                    ) : (
                        <div className="prose prose-invert max-w-none">
                            {content.split("\n").map((line, i) => {
                                if (line.startsWith("# "))
                                    return (
                                        <h1 key={i} className="text-2xl font-bold text-white mb-4">
                                            {line.slice(2)}
                                        </h1>
                                    );
                                if (line.startsWith("## "))
                                    return (
                                        <h2 key={i} className="text-xl font-semibold text-white mt-6 mb-3">
                                            {line.slice(3)}
                                        </h2>
                                    );
                                if (line.startsWith("### "))
                                    return (
                                        <h3 key={i} className="text-lg font-medium text-gray-200 mt-4 mb-2">
                                            {line.slice(4)}
                                        </h3>
                                    );
                                if (line.startsWith("- "))
                                    return (
                                        <li key={i} className="text-gray-600 ml-4">
                                            {line.slice(2)}
                                        </li>
                                    );
                                if (line.startsWith("**") && line.endsWith("**"))
                                    return (
                                        <p key={i} className="font-semibold text-white">
                                            {line.slice(2, -2)}
                                        </p>
                                    );
                                if (line.trim() === "") return <div key={i} className="h-2" />;
                                return (
                                    <p key={i} className="text-gray-600 mb-2">
                                        {line}
                                    </p>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
