import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CdkPrivateYumSampleStack } from '../lib/cdk-private-yum-sample-stack';

describe("CdkPrivateYumSample", () => {
  test("matches the snapshot", () => {
    const app = new cdk.App();
    const stack = new CdkPrivateYumSampleStack(app, 'CdkPrivateYumSampleStack');

    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});