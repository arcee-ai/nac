/**
 * Everything the bar used to spell out — where the store lives, the docs, the
 * repository — behind one button, alongside the configurations the launch
 * modal otherwise only offers while a session is being created.
 */
export declare function HeaderMenu({ onConfigurations, onSshConfigs, onManagedHost, }: {
    onConfigurations: () => void;
    onSshConfigs: () => void;
    onManagedHost?: () => void;
}): import("react").JSX.Element;
