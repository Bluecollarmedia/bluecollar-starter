import { Gauge, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { aspectRatio, background, clipped, containerBackground, font, foregroundStyle, frame, gaugeStyle, kerning, lineLimit, minimumScaleFactor, padding, resizable } from '@expo/ui/swift-ui/modifiers';
import { widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import type { WidgetProps } from '@/lib/widgetData';

/**
 * Brighton Forecast on the home screen and the lock screen: small, medium (the next hours), and the
 * three lock screen sizes. The look follows the approved mockup (light, minimal, the leaf and "BRIGHTON" on every size).
 *
 * A widget runs in its own small runtime, so everything it needs is inside this function (no outside constants, no hooks). The words and
 * figures arrive as props from src/lib/widgetData.ts, already formatted; the widget only lays them out.
 */
const BrightonWeather = (p: WidgetProps, env: WidgetEnvironment) => {
  'widget';
  const family = env.widgetFamily;
  // The approved rendering is the light design on the home screen whatever the phone's mode, so these colours never switch to dark.
  const dark = false;
  const ink = dark ? '#EAF3E6' : '#17301F';
  const soft = dark ? '#A9C0AC' : '#4C6B53';
  const page = dark ? '#18241C' : '#FBFDF8';
  const green = dark ? '#8CCB63' : '#2E5E34';
  const rule = dark ? '#2B3B30' : '#DCE6D5';
  const open = widgetURL('brighton-lawn://weather');
  // The leaf is a picture file at its full size: it must be made resizable and fitted, or the frame alone does not shrink it and it covers the widget.
  const leafMods = (n: number) => [resizable(), aspectRatio({ contentMode: 'fit' }), frame({ width: n, height: n }), clipped()];

  const brand = (label: string, size: number) => (
    <HStack spacing={5}>
      {p.leaf ? <Image uiImage={p.leaf} modifiers={leafMods(size)} /> : null}
      <Text modifiers={[font({ size: 9.5, weight: 'heavy' }), kerning(1.6), foregroundStyle(green), lineLimit(1)]}>{label}</Text>
    </HStack>
  );

  // ── lock screen: one line above the clock ──
  if (family === 'accessoryInline') {
    return <Text modifiers={[open]}>{`${p.place} ${p.temp} ${p.condition}`}</Text>;
  }

  // ── lock screen: the small circle ──
  if (family === 'accessoryCircular') {
    if (p.gauge) {
      return (
        <Gauge
          value={p.gauge.now}
          min={p.gauge.low}
          max={p.gauge.high}
          currentValueLabel={
            <VStack spacing={0}>
              {p.leaf ? <Image uiImage={p.leaf} modifiers={leafMods(13)} /> : null}
              <Text modifiers={[font({ size: 17, weight: 'regular' })]}>{p.temp}</Text>
            </VStack>
          }
          modifiers={[gaugeStyle('circularCapacity'), open]}
        >
          <Text>{p.place}</Text>
        </Gauge>
      );
    }
    return (
      <VStack spacing={0} modifiers={[open]}>
        {p.leaf ? <Image uiImage={p.leaf} modifiers={leafMods(13)} /> : null}
        <Text modifiers={[font({ size: 20, weight: 'regular' })]}>{p.temp}</Text>
      </VStack>
    );
  }

  // ── lock screen: the strip (place and temperature on the left, condition and high/low on the right) ──
  if (family === 'accessoryRectangular') {
    return (
      <HStack modifiers={[open]}>
        <VStack alignment="leading" spacing={0}>
          <HStack spacing={4}>
            {p.leaf ? <Image uiImage={p.leaf} modifiers={leafMods(14)} /> : null}
            <Text modifiers={[font({ size: 12, weight: 'semibold' }), lineLimit(1)]}>{p.place}</Text>
          </HStack>
          <Text modifiers={[font({ size: 28, weight: 'light' })]}>{p.temp}</Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={1}>
          <Text modifiers={[font({ size: 12, weight: 'semibold' }), lineLimit(1)]}>{p.condition}</Text>
          {p.highLow ? <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>{p.highLow}</Text> : null}
        </VStack>
      </HStack>
    );
  }

  // ── home screen: small ──
  if (family === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={0} modifiers={[containerBackground(page, 'widget'), open]}>
        {brand('BRIGHTON', 15)}
        <Spacer />
        <HStack alignment="top">
          <VStack alignment="leading" spacing={1}>
            <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(ink), lineLimit(1)]}>{p.place}</Text>
            <Text modifiers={[font({ size: 42, weight: 'light' }), foregroundStyle(ink), minimumScaleFactor(0.7)]}>{p.temp}</Text>
          </VStack>
          <Spacer />
          <Image systemName={p.symbol as any} size={38} color={p.symbolColor} />
        </HStack>
        <Spacer />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(ink), lineLimit(1)]}>{p.condition}</Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(soft), lineLimit(1)]}>{[p.highLow, p.uv].filter(Boolean).join('  ·  ')}</Text>
        </VStack>
      </VStack>
    );
  }

  // ── home screen: medium (also used for the large sizes, which are not offered) ──
  return (
    <VStack alignment="leading" spacing={0} modifiers={[containerBackground(page, 'widget'), open]}>
      <HStack alignment="top">
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(ink), lineLimit(1)]}>{p.place}</Text>
          <Text modifiers={[font({ size: 42, weight: 'light' }), foregroundStyle(ink), minimumScaleFactor(0.7)]}>{p.temp}</Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(soft), lineLimit(1)]}>{[p.condition, p.highLow].filter(Boolean).join('  ·  ')}</Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={3}>
          <VStack alignment="trailing" spacing={2}>
            <VStack modifiers={[padding({ bottom: 4 })]}>{brand('BRIGHTON FORECAST', 15)}</VStack>
            {p.uv ? <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(soft)]}>{p.uv}</Text> : null}
            {p.rain ? <Text modifiers={[font({ size: 12 }), foregroundStyle(soft), lineLimit(1)]}>{p.rain}</Text> : null}
          </VStack>
        </VStack>
      </HStack>
      <Spacer />
      {p.hours.length ? (
        <VStack spacing={8}>
          <HStack modifiers={[frame({ maxWidth: 10000, height: 1 }), background(rule)]}>
            <Spacer />
          </HStack>
          <HStack>
            {p.hours.flatMap((h, i) => [
              ...(i > 0 ? [<Spacer key={`s${i}`} />] : []),
              <VStack key={`${i}`} spacing={3}>
                <Text modifiers={[font({ size: 12 }), foregroundStyle(soft), lineLimit(1)]}>{h.label}</Text>
                <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(ink)]}>{h.temp}</Text>
              </VStack>,
            ])}
          </HStack>
        </VStack>
      ) : null}
    </VStack>
  );
};

export default createWidget('BrightonWeather', BrightonWeather);
