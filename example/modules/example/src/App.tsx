import { StatefulComponent } from 'valdi_core/src/Component';
import { Label, View } from 'valdi_tsx/src/NativeTemplateElements';
import { Style } from 'valdi_core/src/Style';
import { systemBoldFont, systemFont } from 'valdi_core/src/SystemFont';
import { AttributedText } from 'valdi_tsx/src/AttributedText';
import { AttributedTextBuilder } from 'valdi_core/src/utils/AttributedTextBuilder';
import { getDaemonClientManager } from 'valdi_core/src/debugging/DaemonClientManagerResolver';
import { IDaemonClientManagerListener } from 'valdi_core/src/debugging/DaemonClientManager';
import res from '../res';
import { setListener, startScanning, getLastScan } from 'test_events/src/test_events';
import { set, get } from 'test_params/src/test_params';
import { setString, getString } from 'clipboard/src/clipboard';
import { getKeys } from 'async_storage/src/async_storage';

/**
 * @ViewModel
 * @ExportModel
 */
export interface AppViewModel {}

/**
 * @Context
 * @ExportModel
 */
export interface AppComponentContext {}

interface State {
  hotReloaderConnected: boolean;
  eventResult: string;
  promiseResult: string;
  clipResult: string;
  asResult: string;
}

/**
 * @Component
 * @ExportModel
 */
export class App extends StatefulComponent<AppViewModel, AppComponentContext> implements IDaemonClientManagerListener {
  state: State = { hotReloaderConnected: false, eventResult: 'waiting', promiseResult: 'waiting', clipResult: 'waiting', asResult: 'waiting' };

  onCreate(): void {
    getDaemonClientManager().addListener(this);
    // Events: native fires scanCompleted, TypeScript receives it
    setListener({
      scanCompleted: (payload) => this.setState({ eventResult: `event: barcode ${payload.barcode} (${payload.format})` }),
      decodeError: (payload) => this.setState({ eventResult: `event error: ${payload}` }),
    });
    getLastScan();
    startScanning();
    // Promise: native stores and returns a value
    set({ key: 'example', value: 'roundtrip-ok' })
      .then(() => get({ key: 'example' }))
      .then((result) => this.setState({ promiseResult: `promise get(): ${result.value}` }))
      .catch((e) => this.setState({ promiseResult: `promise FAILED: ${e}` }));
    // React Native module (react-native-clipboard through the RN intake):
    // void setter + promise reader against the system pasteboard
    setString({ content: 'hello from the RN module' });
    getString()
      .then((s) => this.setState({ clipResult: `rn clipboard: ${s}` }))
      .catch((e) => this.setState({ clipResult: `rn clipboard FAILED: ${e}` }));
    // Second RN plugin (AsyncStorage): the storage engine is a prebuilt
    // vendor framework, so every method rejects honestly - proving the
    // module loads and the rejection crosses the bridge
    getKeys({ dbName: "plugin2valdi-example" })
      .then((k) => this.setState({ asResult: `async storage: ${k.length} keys` }))
      .catch((e) => this.setState({ asResult: `async storage (engine not ported): ${String(e).slice(0, 60)}` }));
  }

  onDestroy(): void {
    getDaemonClientManager().removeListener(this);
  }

  onAvailabilityChanged(available: boolean): void {
    this.setState({ hotReloaderConnected: available });
  }

  onRender(): void {
    <view style={styles.main}>
      <image style={styles.logo} src={res.valdi} />
      <layout padding={20}>
        <label style={styles.title} value={`plugin2valdi example`} />
      </layout>
      <label style={styles.subtitle} value={this.renderLabel()} />
      <label style={styles.subtitle} value={this.state.promiseResult} />
      <label style={styles.subtitle} value={this.state.eventResult} />
      <label style={styles.subtitle} value={this.state.clipResult} />
      <label style={styles.subtitle} value={this.state.asResult} />
    </view>;
  }

  private renderLabel(): AttributedText {
    const textBuilder = new AttributedTextBuilder();

    textBuilder.appendText('Modules converted by plugin2valdi, running ');
    textBuilder.appendStyled({
      content: 'natively',
      attributes: {
        color: 'red',
        font: systemBoldFont(20),
      },
    });

    return textBuilder.build();
  }
}

const styles = {
  main: new Style<View>({
    backgroundColor: 'white',
    justifyContent: 'center',
  }),
  logo: new Style<any>({
    width: 80,
    height: 80,
    alignSelf: 'center',
    borderRadius: 16,
    boxShadow: '0 0 3 rgba(0, 0, 0, 0.15)',
  }),
  title: new Style<Label>({
    color: 'black',
    font: systemBoldFont(24),
    accessibilityCategory: 'header',
    alignSelf: 'center',
  }),

  subtitle: new Style<Label>({
    alignSelf: 'center',
    color: 'black',
    font: systemFont(20),
    numberOfLines: 0,
    textAlign: 'center',
  }),
};
