import { ErrorState } from "@/components/states/ErrorState";

export default function NotFound() {
    return <ErrorState code="404" />;
}
